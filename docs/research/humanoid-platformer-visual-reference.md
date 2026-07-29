# Humanoid Visual Reference for 2D Platformers

> Investigated: 2026-07-29  
> Status: **COMPLETE — validation baseline selected**

## Question

What should a procedural humanoid at a nominal `32 × 48` body frame look like
when idle, walking, and airborne in a side-view platformer?

The earlier body-plan research established that a humanoid was useful and that
IK could construct it. It did not establish a sufficiently concrete pose
standard. As a result, the first validation sheet compared the generated
humanoid mainly against itself and failed to reject crossed idle legs and
hands-on-hips arms.

This note supplies the missing visual baseline. The accompanying
`benchmarks/character-body-plans/humanoid-reference-study.png` contains
original analytical diagrams, not copied game sprites.

## Evidence standard

- Developer-authored material is used for production and animation claims.
- Official game pages, trailers, and press images are used for visual
  observation.
- Numerical limits below are our synthesis for this renderer, not measurements
  claimed by the cited developers.
- A reference game is treated as a strategy example, not a style to reproduce.

## Reference strategies

### Dead Cells — articulated, pose-first motion

Thomas Vasseur describes a basic 2D model sheet converted into a simple
skeleton and 3D model. The in-game character is about 50 pixels high, directly
comparable to our nominal 48-pixel frame. Animations are judged on key poses
using the fewest useful frames; interpolation is added around keyframes, not
between weak poses.

Sources:

- [Dead Cells art pipeline deep dive](https://www.gamedeveloper.com/production/art-design-deep-dive-using-a-3d-pipeline-for-2d-animation-in-i-dead-cells-i-)
- [Official Dead Cells site](https://dead-cells.com/)

What we adopt:

- Treat the procedural rig as an animation tool, not proof that a pose is good.
- Validate readable key poses before smoothing transitions.
- Keep a genuine articulated skeleton for locomotion and arm targeting.

What we do not adopt:

- Dense combat animation, weapon-specific animation sets, or the 3D-to-sprite
  rendering pipeline.

### Shovel Knight — simplified sprites and quiet idle

Yacht Club Games documents simplifying character sprites when detail harmed
readability. Its character process also separates the default idle from
attention-getting gestures: idles are generally two frames with a gentle bob,
while a wave or tool action receives the conspicuous pose.

Sources:

- [Creating a Shovel Knight character sprite](https://old.yachtclubgames.com/2020/03/creating-a-shovel-knight-character-sprite/)
- [Breaking the NES](https://www.yachtclubgames.com/blog/breaking-the-nes/)

What we adopt:

- Neutral idle should be quiet and structurally clear.
- Reaching, waving, attacking, and other gestures must not leak into idle.
- Remove detail that does not survive the target scale.

### Hollow Knight — silhouette mass over exposed anatomy

Team Cherry describes a simple, near-monotone, traditionally animated 2D
style chosen partly for production efficiency. Official imagery shows the
Knight using the mask, horns, and cloak mass as the primary read, with limbs
subordinate to that silhouette.

Sources:

- [Introducing Hollow Knight](https://www.teamcherry.com.au/blog/introducing-hollow-knight)
- [Official Hollow Knight site and press imagery](https://www.hollowknight.com/)

What we adopt:

- The torso/head mass must remain readable before limb detail is considered.
- Far limbs should recede; all four limbs must not compete equally.

What we do not adopt:

- Hiding the humanoid rig inside a cloak. This body plan exists partly to expose
  reusable articulated limbs.

### Celeste — state readability at extremely small scale

Official footage and press imagery show a tiny character whose hair shape,
color, squash, and directional silhouette carry more information than
anatomically complete limbs.

Sources:

- [Official Celeste site, trailer, and press kit](https://www.celestegame.com/)
- [Official Celeste changelog](https://www.celestegame.com/changelog.html)

What we adopt:

- Test at sizes smaller than the nominal frame.
- Prefer a distinct whole-body action silhouette over subtle joint accuracy.
- Gameplay state may need a larger secondary shape or color cue in a future
  skin layer.

What we do not adopt:

- Collapsing the base humanoid into an opaque sprite-like mass at 32 × 48.

## Selected visual grammar

The production target is an **articulated-minimal three-quarter profile**:

- a single head and torso form the primary mass;
- two legs and two arms remain visible for procedural motion;
- the far-side limbs use lower visual priority and draw before the torso;
- the near-side limbs draw later with stronger contrast;
- neutral poses are almost symmetrical but use layering to communicate depth;
- action poses may become strongly asymmetric;
- horizontal facing is still handled by mirroring one canonical pose.

This is closer to Dead Cells structurally, Shovel Knight in idle restraint, and
Hollow Knight/Celeste in small-scale silhouette discipline.

## Normalized neutral-pose rules

Let `H` be the local body height (`48` at the nominal validation size).

| Rule | Required range or invariant | Reason |
|---|---:|---|
| Foot separation | `0.08H–0.16H` | Stable base without a wide squat |
| Left/right foot order | left `< 0`, right `> 0` | No crossed neutral stance |
| Knee side | each knee remains on its foot’s side of center | Rejects X legs |
| Hip height | legs use at least 90% of available extension | Rejects idle crouch |
| Hand height | below pelvis, above knee | Relaxed arm, not hands-on-hips |
| Hand side | each hand remains outside its shoulder-side centerline | No torso crossing |
| Arm reach | shoulder-to-hand `> 0.9 ×` total arm length | Slight bend, not chicken wing |
| Center of mass | body center lies between planted feet | Stable support |
| Idle motion | breathing/bob only; no gait pose at zero displacement | Quiet default |

All positions must be finite and both segments of every solved limb must retain
their configured lengths.

## Locomotion key-pose rules

Validation must show poses rather than only trajectories:

1. **Contact:** leading foot reaches forward as the trailing foot finishes
   stance; opposite arm leads.
2. **Down/recoil:** hips lower slightly as weight is accepted.
3. **Passing:** the swing foot passes the planted leg with a clear knee lift.
4. **Up/high point:** hips rise slightly before the next contact.
5. **Opposite contact:** limb roles exchange without changing body identity.

For this small procedural renderer, at least contact, passing, and opposite
contact must be present on the permanent sheet. Hip travel should remain under
`0.04H`; larger motion reads as bouncing rather than walking.

The gait phase must be driven by facing-local displacement, as established in
`docs/research/walk-cycle-direction-conventions.md`.

## Airborne key-pose rules

- **Ascent:** both feet visibly leave the baseline; knees begin to gather.
- **Apex:** silhouette is compact and neither foot implies ground contact.
- **Descent:** legs extend enough to anticipate landing without re-entering the
  walk cycle.
- **Landing:** feet meet the baseline and a brief body compression may occur.

The exact limb angles can vary by seed, but the four silhouettes must remain
distinguishable at `16 × 24`.

## Arm behavior rules

- Passive walking arms oppose the legs.
- Neutral arms hang beside the torso with shallow bends.
- An explicit target may override the near arm only.
- Targeting must not pull the untargeted arm into a matching gesture.
- Future weapon/shield poses need their own validation rows rather than
  overloading neutral idle.

## Required validation views

Every future humanoid candidate sheet must include:

- neutral idle;
- contact, passing, and opposite-contact walk poses;
- ascent, apex, descent, and landing;
- both facings;
- explicit arm target;
- grayscale silhouette;
- `32 × 48`, `16 × 24`, and `8 × 12` scale checks;
- production/prototype byte comparison;
- geometry-level neutral-pose tests.

## Decision

The existing procedural approach remains viable, but approval is now against
this reference baseline rather than against a self-generated sheet.

The corrected neutral feet and arms satisfy the static invariants. The current
permanent sheet still needs to be expanded from two arbitrary stride samples
to named contact/passing/opposite-contact poses and to add an explicit landing
panel before the humanoid should be considered visually complete.

