# Integration

## How to consume aicraft-engine

### Option A: Git submodule (recommended)

Preserves the consumer's zero-runtime-deps invariant and keeps source greppable for AI agents.

```bash
# From your game repo root
git submodule add <aicraft-engine-git-url> src/lib/aicraft-engine
git commit -m "Add aicraft-engine submodule"
```

Then import from a relative path:

```ts
// From src/main.ts in the consumer
import { outlineRect } from './lib/aicraft-engine/src/primitives';
import { mulberry32 } from './lib/aicraft-engine/src/rng';
```

**TypeScript config:** `moduleResolution: "bundler"` + `include: ["src"]` already covers the submodule path. No consumer `tsconfig.json` change needed.

**Vite config:** no change needed. Vite resolves relative paths transparently.

**Test config:** if you don't want the submodule's own tests to run as part of your suite, scope your `vitest.config.ts` `include` (e.g. `['src/**/*.test.ts', '!**/lib/aicraft-engine/**']`).

### Option B: Vendored copy

If submodule overhead is unwanted, copy the library into `src/lib/aicraft-engine/` directly. Add a `README.md` at the copy root noting the canonical upstream so re-syncs are easy.

```bash
cp -r /path/to/aicraft-engine/src /path/to/game/src/lib/aicraft-engine/
```

### Option C: npm package (NOT recommended for Spitekeep-family games)

The library is structured to be publishable, but doing so adds a `dependencies` entry to the consumer's `package.json`. Spitekeep deliberately has zero `dependencies` as a minimalist invariant; publishing would break that.

This option is fine for **external consumers** (Premium AI Craft customers building their own games outside the Spitekeep family), but not for sibling games in the Clone-to-Jest pipeline.

## Consumer-side integration patterns

### Palette as a consumer of the engine

The consumer's `palette.ts` should switch from a flat `as const` object to a factory that consumes the engine's palette-substitution layer (Phase 2):

```ts
// Before (Spitekeep-style)
export const PALETTE = { devilBody: '#FE5701', ... } as const;

// After (engine-integrated)
import { createPalette } from './lib/aicraft-engine/src/palette';
const BASE_PALETTE = { devilBody: '#FE5701', ... };
export function getPalette(activeSkinId: string | null): Palette {
  return createPalette(BASE_PALETTE, activeSkinId);
}
```

### Save schema extension

The consumer's `SaveData` (Spitekeep's `platform/types.ts`) migrates to a new version that carries cosmetic-ownership fields:

```ts
// Spitekeep v1
interface SaveData {
  version: 1;
  // ... existing fields
}

// Spitekeep v2 (after Phase 2 integration)
interface SaveData {
  version: 2;
  // ... existing fields
  equippedSkin: string | null;
  ownedSkins: string[];
}
```

The migration logic in `platform/save.ts` upgrades v1 → v2 by adding defaults.

### IAP bridge instance

The consumer creates a single IAP bridge instance at startup and passes it to whoever needs to query or transact:

```ts
// platform/iap.ts in the consumer
import { createLocalStorageIAPAdapter } from './lib/aicraft-engine/src/iap/adapters/local-storage';
export const iap = createLocalStorageIAPAdapter({ catalog: [...], storageKey: 'aicraft-iap' });
```

## Synchronization strategy

When `aicraft-engine` evolves, consumers update via:

- **Submodule:** `git submodule update --remote src/lib/aicraft-engine && git commit`
- **Vendored:** re-run the copy command and review the diff

The library's version follows semver. Breaking changes to public APIs bump the major version. The `CHANGELOG.md` (to be added at v1.0) lists migrations required.
