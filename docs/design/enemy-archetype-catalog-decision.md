# Enemy Archetype Catalog Validation Decision

> Date: 2026-07-29  
> Status: **APPROVED — Promote charger prototype**  
> Published baseline: `72ef6c62d14f8eef1be94c20c2093a5b5cba97af`  
> Development base: `6d4906624dac359f186fcbc583af96e8e9ffd66e`

## Decision

Promote only the charger archetype and the general collision-owned
`checkLineOfSight` primitive.

The charger keeps the existing `EnemyBehaviorHandler` contract and is registered
as a built-in by `createEnemyBehaviorRegistry`. It has fixed `16 × 16`
dimensions, a deterministic `patrol → windup → dash → recovery` state machine,
bounded swept horizontal movement, composed entity/tile ledge sensing, and a
built-in shape-driven renderer. It remains a contact hazard and introduces no
combat kernel.

## Evidence and review

Research inputs:

- `docs/research/enemy-archetype-catalog.md`
- `docs/design/enemy-archetype-catalog-proposal.md`

Benchmark:

- `benchmarks/enemy-archetype-catalog/charger-prototype.png`

Visual review found:

- Windup compresses backward and becomes progressively more extreme; it is
  readable before dash without relying on color.
- Dash has a rigid forward silhouette and locked facing.
- Impact/recovery slumps and adds sparks, remaining distinct in grayscale.
- Both directions and the player scale reference remain legible.

Architecture verdict: **APPROVED**.

- LOS is a pure defensive supercover traversal with start/end queries,
  orthogonal-plus-diagonal corner coverage, endpoint-reversal tests, unique
  visits, predicted/runtime caps, and fail-closed malformed-query behavior.
- Charger phase entry and transition ticks preserve observable windup and
  recovery frames.
- Parameter failures use named defaults rather than clamping.
- Dash and patrol movement scan solids once and never substep by distance.
- Thin walls stop the body flush; passthrough walls do not block horizontal
  movement.
- Entity and tile support compose; either can keep patrol moving.
- Existing spinny, turret, and spider APIs remain unchanged.
- Inputs are not mutated and benchmark renders are byte-deterministic.

## Alternatives

- The full five-archetype catalog was rejected for this release because it
  would introduce unvalidated projectile, surface, and combat-adjacent
  abstractions.
- Consumer renderer registration was deferred; built-ins use internal dispatch
  and unknown archetypes retain the outlined fallback.
- `EnemyArchetype` module augmentation was rejected because a type alias is not
  an augmentable interface. Runtime extensibility remains through
  `EnemyProps.archetype: string` and custom behavior registration.

## Deferred scope

Chaser, burster, flyer, crawler, projectile lifetime/plural results, general
telegraphs, damage, knockback, health, i-frames, and custom charger dimensions
are not part of `0.5.0`.

## Migration and production requirements

This is additive. Canonical charger dimensions and numeric limits must live in
the dependency-neutral level schema so validation, compilation, catalog,
behavior, and rendering cannot drift. Production LOS moves to
`src/collision/los.ts`; prototype files remain outside the npm tarball.
