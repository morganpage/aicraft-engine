# Changelog

All notable changes to `aicraft-engine` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/morganpage/aicraft-engine/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/morganpage/aicraft-engine/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/morganpage/aicraft-engine/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/morganpage/aicraft-engine/releases/tag/v0.5.0
