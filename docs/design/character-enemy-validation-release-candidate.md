# Character/Enemy Validation Release-Candidate Handoff

> Date: 2026-07-29  
> Status: **READY FOR USER APPROVAL**  
> Candidate version: `aicraft-engine@0.5.0`

## Source identity

- Published `0.4.0` baseline:
  `72ef6c62d14f8eef1be94c20c2093a5b5cba97af`
- Development base and current `main`:
  `6d4906624dac359f186fcbc583af96e8e9ffd66e`
- Release-candidate implementation commit:
  `8b305c06dc65d344332b34ec589607b0b885ba11`
- Release-candidate implementation tree:
  `d714da97170994ab76201b6b30d54e5d8d4eae72`
- Branch: `codex/character-enemy-validation`
- Worktree was clean when the candidate artifact was packed.
- `package.json` and `package-lock.json` both report `0.5.0`.

This handoff document is an administrative follow-up to the implementation
commit. It is excluded from the npm package and does not change packed runtime
or declaration content.

## Exact artifact

- Filename: `aicraft-engine-0.5.0.tgz`
- Size: 553,511 bytes
- Unpacked size: 1,840,824 bytes
- Entry count: 463
- SHA-1: `73c0b541ebafa43edb2ba599dc1ea99cbcf2695a`
- SHA-512:
  `sha512-Gu90HzhTHc0YaAgzE/jVFJdLcgSpMf57dXRdDj98koucSBI1ezsmlzyGk1xdMxvuMgemkQcX80lk0W4vdLXjfg==`

The tarball contains production `dist/character`, collision LOS, charger,
declarations, README, license, and package metadata. It contains no prototype,
showcase, benchmark, or test files and has no runtime dependencies.

## Gate results

Phase 15.5: **CONFIRM**

- Humanoid production and prototype PNG SHA-256:
  `5f93f6100c5b798bff45b82bcdafe4a8a38393e2943ff79cb6995e1a129a1d5f`
- Charger production and prototype PNG SHA-256:
  `cad16310317a96be7f5921f5f63eea4bc477455401e4e4fdb69b4b35a4c1911d`
- Both production sheets are byte-identical to the approved prototypes.
- Production architecture matches both decision documents.

Phase 16: **PASS**

- 2,800 library tests passed across 143 files.
- 222 showcase tests passed across 10 files.
- Library typecheck, distribution build, showcase typecheck, and showcase build
  passed.
- Package dry-run and exact `npm pack --json` passed at `0.5.0`.

Phase 17: **PASS**

- The exact tarball installed into a fresh strict TypeScript/Vite project.
- Package-root-only humanoid/platformer wiring typechecked and bundled.
- Bundled runtime assertions passed for charger registration, fixed dimensions,
  and empty-path LOS.
- A collision-only Rollup graph contained two modules and no character or
  charger implementation modules.
- The smoke source contained no `JumpState` or `advanceJump` humanoid coupling.
- Plain Node ESM was not treated as a supported path: as documented in the
  README, emitted extensionless internal imports require a bundler. The runtime
  entry was bundled to Node ESM before execution.

## Handoff

`main` has not advanced beyond the recorded development base, so the candidate
does not need synchronization. No merge, tag, or npm publication has occurred.
Those actions require explicit user approval.
