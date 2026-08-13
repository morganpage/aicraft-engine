# Changelog

All notable changes to `aicraft-engine` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.1] - 2026-08-13

### Fixed
- **Docs:** corrected `README.md` — the package works in **plain Node ESM with no bundler** (the `build:dist` step rewrites the dist's extensionless specifiers to `.js`, verified by `release:smoke`'s Node-ESM gate). The prior "Bundler required" note was stale.
- **Dependencies:** `npm audit fix` resolved two high-severity **development-only** transitive advisories (`nanoid` ≤3.3.17, `postcss` ≤8.5.22, both via Vite). Lockfile-only — `package.json` devDependency ranges unchanged, so no runtime/tarball impact.
- **Changelog:** backfilled the missing `[0.7.0]`/`[0.8.0]`/`[0.8.1]`/`[0.9.0]` comparison links and repointed `[Unreleased]` at `v0.9.1...HEAD`; resynced the stale `package-lock.json` top-level version.

## [0.9.0] - 2026-08-13

### Added
- **Platformer:** Ledge mantle (physics v12) — holding grab + Up near the top of a clear wall performs a continuous multi-tick assisted hop onto the ledge: the actor rises beside the wall, crosses the lip once its feet clear, and lands through the normal collision resolver. Mantle code never assigns actor position (no teleport/snap); a conservative preflight (`src/platformer/mantle.ts`, module-private) declines under ceilings/overhangs or onto occupied footholds, and passthrough/ladder/spring/dash-refill volumes never block it. Tuning: `mantleEnabled` (default on, inert without `wallGrabEnabled`), `mantleHopVx`, `mantleHopVy` (minimum — the launch magnitude is derived from actor/wall geometry under the jump gravity), `mantleApexClearance`, `mantleLandingInset`, `mantleAssistTime`.
- **Platformer:** Direction-aware grab+jump (physics v12) — jumping while grabbing now branches on the latched wall side + the SIGN of `moveX` (analog magnitude ignored): Away keeps the classic up-and-away climb-hop; Neutral/Toward launches a straight-up **climb-jump** (`vx = 0`, faces the wall, `climbJumpRegrabLockTime` re-grab lock — fixes the 4 px re-cling jitter). New launch sources `'climbJump'`/`'mantle'` (priority 3, no forced-horizontal window); new event pulses `climbJumpLaunched`/`mantled`; `WallGrabAbilityState` gained `regrabTimer` + the `mantle` assist record; `LocomotionMode` gained `'mantle'` (skips horizontal input only — gravity + collision stay authoritative).

### Changed
- **Platformer:** `wallJumpLaunched` was DELIBERATELY WIDENED to also fire for away climb-hops (previously pulse-less) — consumers reading that pulse will start seeing climb-hops. Dash retains priority over both new behaviors; jump retains priority over the mantle.
- **Replay:** `CURRENT_PHYSICS_VERSION` 11 → 12. Neutral/toward grab+jump trajectories intentionally change; scenarios that never hold grab are trace-unchanged but every replay hash shifts (widened config/events/state + version).
- **Docs:** the Celerock build brief (`games/celerock.md`) now mandates Celeste's actual PC-default keyboard bindings (Arrows + `C`/`X`/`Z`, not the engine's `Space`/`Shift`/`KeyK` standard map) and renders the supplied `Player.png` sprite from the first play tick (no procedural-then-swap phase).

### Fixed
- **Platformer:** the wall-grab ability now clears any active grab/mantle state when `wallGrabEnabled` is false, so disabling the ability (e.g. a per-call `config` flip on `stepPlatformer`) cannot leave its exclusive `'wallGrab'`/`'mantle'` locomotion mode latched. An already-idle state remains an identity no-op.

## [0.8.1] - 2026-08-13

### Fixed
- **LDtk:** resolve `projectUrl` relative to the project file (was treating it as absolute); narrowed the collectibles bucket.

## [0.8.0] - 2026-08-13

### Added
- **Platformer feel + traversal layer:** structured feel channel (`state.moments` — `landing { impactSpeed, normalizedImpact, hard, solidId }`, one-shot `dashBonk { normalX, normalY, solidId }` per blocked axis per dash, observation-only `dashEnded { reason, terminalContact }`, `grabLatch`/`staminaExhausted`, `springLaunch`/`dashRefill`); pure room-transition helpers (`findLdtkRoomExit` / `mapLdtkRoomEntry` / `transitionPlatformerToRoom` / `rebasePointBetweenLdtkRooms`); room-slide orchestrator (`beginRoomSlide` + the camera-space rebases); explicit camera fit (`fitCameraZoom`).

### Changed
- **Replay:** physics version 10 → 11 (the `moments` state field is replay data; v10 replays rejected). A manually-constructed `PlatformerState` now needs `moments: []`.

## [0.7.0] - 2026-08-13

### Added
- **Celerock golden path:** Node-ESM-importable dist; high-level async LDtk loader (`loadLdtkProjectAssets`) + asset preflight (`inspectLdtkPlatformerProject`); per-room `compileLdtkRoom` / `createLdtkRoomCache`; tile-unit config scaling (`scalePlatformerConfig` / `createPrecisionPlatformerConfig`); shared input edges (`IDLE_EDGE`, `STANDARD_KEYBOARD_PLATFORMER_MAP`, `STANDARD_GAMEPAD_PLATFORMER_MAP`); game-loop `onError` / `errorPolicy`; spawn `'rest-on-surface'` resolution; spring / dash-refill entity mappings.

### Fixed
- **Package:** packed dist is Node-ESM-importable (extensionless `.d.ts` specifier fix); added `release:smoke` (packed-tarball Node + NodeNext + Vite consumer gates) and CI; the nested `npm pack`/`install` inside the publish lifecycle survives.

## [0.6.0] - 2026-08-12

### Added
- **Camera:** Light Cinemachine-style camera brain — virtual cameras (vcams), blends, and deadzone follow.
- **Platformer:** Celeste-inspired physics overhaul (Phases 0–9): tighter movement, jump, and air-control feel.
- **Platformer:** `groundDuckEnabled` opt-out for the grounded duck latch.

### Fixed
- **Camera:** Preserve blend continuity when a virtual-camera source is removed.
- **Camera:** Blend clamp crossfade correctness; `dt=0` is now a no-op, and the director guide is corrected.

## [0.5.1] - 2026-08-10

### Changed
- Filled the npm package's empty storefront fields now that the repo is public (repository, homepage, bugs, author, keywords) so npmjs.com links to source/issues and npm search finds the package.
- Added the "Create Games with AI" community link to the README tagline; genericized remaining brand-specific prose to brand-neutral phrasing.

### Notes
- No code change; `dist/` identical to 0.5.0 apart from `package.json`/`README` metadata.

## [0.5.0] - 2026-08-10

### Added
- Scope expansion release: charger + idle humanoid + LDtk native pipeline + Aseprite sprites + ladder/climb + terrain-art.

### Notes
- Humanoid motion poses (H3/H4) deferred to a future release. See `docs/design/0.5.0-scope-decision.md`.

[Unreleased]: https://github.com/morganpage/aicraft-engine/compare/v0.9.1...HEAD
[0.9.1]: https://github.com/morganpage/aicraft-engine/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/morganpage/aicraft-engine/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/morganpage/aicraft-engine/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/morganpage/aicraft-engine/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/morganpage/aicraft-engine/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/morganpage/aicraft-engine/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/morganpage/aicraft-engine/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/morganpage/aicraft-engine/releases/tag/v0.5.0
