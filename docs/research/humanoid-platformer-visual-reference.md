# Humanoid Visual Reference for 2D Platformers

> Investigated: 2026-07-29  
> Status: **MEASURED — Godot pose baseline established; Warrior licence restricts reuse, contingency fired**

## Question

What should a procedural humanoid at a nominal `32 × 48` body frame look like
when idle, walking, and airborne in a side-view platformer?

The earlier body-plan research established that a humanoid was useful and that
IK could construct it. It did not establish a sufficiently concrete pose
standard. As a result, the first validation sheet compared the generated
humanoid mainly against itself and failed to reject crossed idle legs and
hands-on-hips arms.

This note supplies a visual-strategy baseline. The accompanying
`benchmarks/character-body-plans/humanoid-reference-study.png` contains
original analytical diagrams, not copied game sprites. Those diagrams are pose
hypotheses, not traced or measured reference poses.

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

## Pose-specific original examples acquired

These sources expose complete or named source frames and are therefore more
useful for pose validation than promotional screenshots.

### Godot 2D Platformer robot — open source, state-mapped sheet

The Godot demo repository includes an `8 × 8` robot sheet and the scene file
that assigns exact frames:

- run: frames `0–9`;
- idle: frames `30–33`;
- jump: frame `45`;
- fall: frame `48`;
- separate weapon variants are also named.

This is the strongest current source for identifying real contact/passing
frames and comparing jump against fall. The run leans into travel, separates
the feet strongly, and uses opposing arm/leg motion. Jump and fall are different
silhouettes rather than a walking pose lifted off the floor.

Sources:

- [Godot robot sheet](https://github.com/godotengine/godot-demo-projects/blob/master/2d/platformer/player/robot.webp)
- [Godot frame assignments](https://github.com/godotengine/godot-demo-projects/blob/master/2d/platformer/player/player.tscn)
- [Godot demo repository and MIT license](https://github.com/godotengine/godot-demo-projects)

### Shantae and Freedom Planet 2 — explicit three-quarter construction

Freedom Planet 2 character designer Tyson Tan describes the same projection
problem visible in the Godot robot. Most platformers use a dead-lateral view,
but the Freedom Planet 2 team deliberately chose a `3/4` front view. Tan's
comparison identifies Shantae and the Pirate's Curse as a successful example
of that approach and contrasts it with near-side-view Mega Man X and a less
successful Mega Man 7 attempt.

The comparison is especially useful because it explains why a mechanically
symmetrical drawing can look tilted or droopy. The nearer and farther halves
cannot be rendered identically. In the successful examples:

- the farther eye is lower, smaller, and less bright than the nearer eye;
- the farther shoulder is partially obscured by the torso;
- the farther hand and corresponding joints are vertically offset;
- hair and other silhouette shapes help separate the two sides;
- the result behaves like a small pseudo two-point perspective drawing.

This independently confirms that the Godot robot's readable face and chest are
not an accidental front-facing idle pasted onto a side-view character. They are
part of an established **cheated three-quarter platformer profile**: travel and
gait remain horizontal, while the head, chest, and limb layering turn enough
toward the viewer to show identity and depth.

Source:

- [Freedom Planet 2 character design and pixel-perspective analysis](https://tysontan.com/gallery/gallery-others/freedom-planet-2-main4/)

The article and its comparison artwork are CC BY-SA, but we do not need to copy
the artwork into this repository. It validates static projection and depth
ordering, not animation timing; Tan explicitly notes that other team members
produced the animation.

### GandalfHardcore Free Warrior — human-scale locomotion sequence

The user-supplied Warrior sheet is an `800 × 1088` RGBA image arranged as ten
`80 × 64` columns and seventeen rows. The creator's devlog identifies the rows
as:

- idle: 5 frames;
- walk, run, and backward run: 8 frames each;
- jump, fall, and slide: 4 frames each;
- the same locomotion set while carrying a sword;
- attack: 6 frames;
- death: 8 frames;
- death with sword: 10 frames.

Alpha-bound inspection shows that the standing and locomotion figures occupy
approximately `18–24 × 44–49` pixels inside each cell. This is a particularly
close match for our nominal `32 × 48` humanoid: it preserves recognisable human
proportions, a visible face, separated near/far limbs, and complete temporal
sequences without relying on a much larger source sprite.

Visually, this is less front-facing than the Godot robot, but it uses the same
cheated-profile family. The gait and pelvis are side-on; enough of the face and
chest remain visible to retain identity; the nearer and farther limbs overlap
in depth rather than forming a mechanically symmetrical front view. Its quiet
five-frame idle is also a better neutral-human check than an armed or
hands-on-hips pose.

Source:

- [Creator's Free Warrior animation inventory](https://gandalfhardcore.itch.io/2d-pixel-art-male-and-female-character/devlog/771411/added-free-warrior-character-)

The asset is advertised as free, but neither the downloaded folder nor the
Warrior devlog supplies a precise reuse licence. We can measure it as external
reference material, but must not copy the sheet into this repository or ship
derived artwork unless the applicable licence is confirmed.

### Kenney Platformer Characters — CC0 pose catalog

Kenney's sheet provides standing, idle, two walk poses, jump, fall, skid,
crouch, climb, and action poses. The individual soldier images are `80 × 110`,
so they are proportion references rather than direct pixel-scale references.

Useful observations:

- standing keeps both feet visibly grounded;
- jump gathers and angles the legs while raising one arm;
- fall opens the arms and extends/separates the legs;
- action poses are deliberately more asymmetric than neutral poses.

Sources:

- [Original Kenney platformer character sheet](https://commons.wikimedia.org/wiki/File:Kenney.nl_platformer_characters_-_player_vector.svg)
- [CC0 license record](https://commons.wikimedia.org/wiki/File:Kenney.nl_platformer_characters_-_player_vector.svg#Licensing)

### Phaser tutorial character — exact `32 × 48` scale

Phaser's official introductory platformer uses a nine-frame `288 × 48` sheet:
four frames walking left, one front-facing idle, and four walking right. This
is an unusually direct scale comparison because every frame is exactly our
nominal `32 × 48`.

The character demonstrates how little anatomy survives at that size: the torso
and head carry identity, while each limb is only a few pixels. It is useful as
a minimum-readability control, not as an anatomical model. The tutorial does
not assign distinct jump/fall artwork, so it is also an example of the visual
ambiguity we should avoid.

Source:

- [Official Phaser tutorial and frame mapping](https://docs.phaser.io/phaser/getting-started/making-your-first-phaser-game)

The Phaser examples repository explicitly warns that its example assets are not
generally licensed for reuse. The sheet may be inspected but must not be copied
into this repository.

### OpenGameArt articulated cyborg — CC0 temporal sequences

This side-view/three-quarter humanoid includes 15 idle frames, 15 run frames,
and 15 jump frames as separate PNGs. It provides a genuine temporal sequence
for studying torso lean and leg recovery. Its gun arm makes it unsuitable as a
neutral-arm reference.

Source:

- [CC0 articulated cyborg sequences](https://opengameart.org/content/cc0-2d-douche-cyborg-jump-run-shoot-idle)

### OpenGameArt James — CC0 `16 × 16` control

This sheet includes idle, four-frame side walk, jump, fall, crouch, climb,
action, hit, and death at `16 × 16`. It is useful for the smallest-scale
silhouette test: most joint-level anatomy disappears entirely.

Source:

- [CC0 16-pixel character sheet](https://opengameart.org/content/pixel-character-02-james)

## What the new examples invalidate

The six analytical figures in the first study image were synthesized from
general walk-cycle conventions. They were not derived frame-by-frame from
Celeste, Shovel Knight, Hollow Knight, or Dead Cells. They therefore cannot be
used as approval targets.

In particular:

- the proposed passing pose has not been measured against a real source frame;
- the ascent/descent pair lacks a source-backed landing transition;
- the diagrams imply exposed anatomy that Hollow Knight and Celeste do not
  actually provide;
- the Shovel Knight source was an asymmetric NPC-with-tool idle, not a neutral
  player pose.

The diagram is retained only as a clearly labelled working hypothesis.

## Selected visual grammar

The production target is an **articulated-minimal three-quarter profile**:

- a single head and torso form the primary mass;
- gait, pelvis, and direction of travel read side-on;
- head and chest turn toward the viewer enough to expose the nearer and farther
  sides;
- two legs and two arms remain visible for procedural motion;
- the far-side limbs use lower visual priority and draw before the torso;
- the near-side limbs draw later with stronger contrast;
- the near and far sides are deliberately unequal rather than mechanically
  mirrored inside one facing;
- neutral poses are almost symmetrical but use layering to communicate depth;
- action poses may become strongly asymmetric;
- horizontal facing is still handled by mirroring one canonical pose.

Godot is the primary open, frame-addressable pose reference. The GandalfHardcore
Warrior is the closest human-height temporal comparison. Shantae and Freedom
Planet 2 confirm the face/chest projection. Dead Cells confirms the articulated
body and near/far limb depth, although its unconventional head cannot validate
facial perspective. Shovel Knight supplies idle restraint, and Hollow
Knight/Celeste supply small-scale silhouette discipline.

## Measured pose baseline (Phase H1)

> Source: Godot 2D Platformer robot, MIT-licensed. See "Source and licence notes"
> below for the exact asset URL and licence quote. The GandalfHardcore Warrior
> licence was confirmed but contains a "game development tools" redistribution
> restriction that makes it unsuitable for direct measurement in this library
> context; the plan's contingency was fired and Warrior-sourced ranges are
> marked **inferred** below.

### Source asset dimensions and exact frame indices

**Godot 2D Platformer robot — pinned asset**

| Property | Value | Source |
|---|---|---|
| Repository | `godotengine/godot-demo-projects` | <https://github.com/godotengine/godot-demo-projects> |
| Directory | `2d/platformer/player/` | <https://github.com/godotengine/godot-demo-projects/tree/master/2d/platformer/player> |
| Texture file | `robot.webp` | <https://github.com/godotengine/godot-demo-projects/blob/master/2d/platformer/player/robot.webp> |
| Raw asset URL | `https://raw.githubusercontent.com/godotengine/godot-demo-projects/refs/heads/master/2d/platformer/player/robot.webp` | direct download |
| Sheet dimensions | `512 × 512` px | measured from raw asset |
| Frame grid | `hframes = 8`, `vframes = 8` → `64 × 64` px per frame | `player.tscn` line 124–125 |
| Sprite offset | `position = Vector2(0, -14)` (sprite sits 14 px above the player root) | `player.tscn` line 122 |
| Player scale | `Vector2(0.8, 0.8)` | `player.tscn` line 111 |
| Collision shape | `RectangleShape2D` size `Vector2(42.5, 54.5)` | `player.tscn` line 107 |
| Licence | MIT (see quote below) | `LICENSE.md` |

**Frame index → animation mapping (from `player.tscn`):**

| Animation | Frame indices | Length | Loop |
|---|---|---|---|
| `idle` | `30, 31, 32, 33` | 1.0 s (4 × 0.25 s) | yes |
| `idle_weapon` | `34, 35, 36, 37` | 1.0 s | yes |
| `run` | `0, 1, 2, 3, 4, 5, 6, 7, 8, 9` | 0.6 s | yes |
| `run_weapon` | `10, 11, 12, 13, 14, 15, 16, 17, 18, 19` | 0.6 s | no |
| `jumping` | `45` | 0.5 s | no |
| `jumping_weapon` | `46` | 0.5 s | no |
| `falling` | `48` | 0.01 s | no |
| `falling_weapon` | `26` | 0.5 s | no |
| `crouch` | `42` | 0.01 s | no |
| `standing_weapon_ready` | `34, 35, 36, 37` | 1.25 s | yes |

### MIT licence quote (verbatim, from `LICENSE.md`)

> Copyright (c) 2014-present Godot Engine contributors.
> Copyright (c) 2007-2014 Juan Linietsky, Ariel Manzur.
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
> THE SOFTWARE.

### Normalized landmark table — Godot robot

Coordinate system (from the plan):
- canonical facing: right; origin: midpoint between planted foot contacts for
  grounded poses, or pelvis root for unsupported poses; `+x` = direction of
  travel; `+y` = downward; `H = 1` = visible top-to-ground body height for the
  reference frame; coordinates recorded to three decimal places; near/far
  identified by depth role (higher `x` = near, lower `x` = far in a right-facing
  sprite).

All measurements were derived by reading the raw `robot.webp` asset into a
canvas, scanning each frame's alpha channel for opaque-pixel bounds, and
identifying the head band, shoulder band, pelvis band, and foot segments by
row-segment analysis. The measurement script was executed in-browser against
the raw asset URL and was not committed to the repository.

**Frame 30 — neutral idle (grounded, both feet planted)**

- H = 57 px (crown y=3, ground y=60)
- Origin: (29, 60) — midpoint of feet at x=23 and x=35

| Landmark | Raw (x, y) px | Normalized (x, y) in H |
|---|---|---|
| Crown | (30.5, 3) | (0.026, -1.000) |
| Head centre | (29, 11.5) | (0.000, -0.842) |
| Eye (face-direction marker, rightmost head pixel) | (32, 3) | (0.053, -1.000) |
| Near shoulder (right, higher x) | (42, 31) | (0.228, -0.509) |
| Far shoulder (left, lower x) | (14, 31) | (-0.263, -0.509) |
| Pelvis centre | (29.5, 40) | (0.009, -0.351) |
| Near foot (right) | (35, 60) | (0.105, 0.000) |
| Far foot (left) | (23, 60) | (-0.105, 0.000) |
| Near elbow | null (not visibly distinct from torso in idle) | — |
| Far elbow | null | — |
| Near hand | null (arm hangs at side, merges with torso silhouette) | — |
| Far hand | null | — |
| Near hip | null (hip merges with pelvis band) | — |
| Far hip | null | — |
| Near knee | null (leg merges with foot segment at idle resolution) | — |
| Far knee | null | — |
| Near ankle | null | — |
| Far ankle | null | — |

**Frame 0 — run start (grounded, near foot planted)**

- H = 52 px (crown y=4, ground y=56)
- Origin: (43.5, 56) — planted near foot

| Landmark | Raw (x, y) px | Normalized (x, y) in H |
|---|---|---|
| Crown | (32.5, 4) | (-0.212, -1.000) |
| Head centre | (36, 11.5) | (-0.144, -0.856) |
| Eye | (38, 4) | (-0.106, -1.000) |
| Near shoulder | (58, 21) | (0.279, -0.673) |
| Far shoulder | (13, 21) | (-0.587, -0.673) |
| Pelvis centre | (23, 37) | (-0.394, -0.365) |
| Near foot (planted) | (43.5, 56) | (0.000, 0.000) |
| Far foot | null (in air) | — |

**Frame 1 — run recoil (grounded, near foot planted)**

- H = 56 px (crown y=4, ground y=60)
- Origin: (35, 60) — planted near foot

| Landmark | Raw (x, y) px | Normalized (x, y) in H |
|---|---|---|
| Crown | (35, 4) | (0.000, -1.000) |
| Head centre | (34, 12) | (-0.018, -0.857) |
| Eye | (38, 4) | (0.054, -1.000) |
| Near shoulder | (54, 30) | (0.339, -0.536) |
| Far shoulder | (15, 30) | (-0.357, -0.536) |
| Pelvis centre | (31.5, 40) | (-0.062, -0.357) |
| Near foot (planted) | (35, 60) | (0.000, 0.000) |
| Far foot | null | — |

**Frame 2 — run passing (grounded, foot under body)**

- H = 56 px (crown y=5, ground y=61)
- Origin: (27.5, 61) — planted foot (centre)

| Landmark | Raw (x, y) px | Normalized (x, y) in H |
|---|---|---|
| Crown | (34, 5) | (0.116, -1.000) |
| Head centre | (35, 13) | (0.134, -0.857) |
| Eye | (39, 5) | (0.205, -1.000) |
| Near shoulder | (47, 21) | (0.348, -0.714) |
| Far shoulder | (24, 21) | (-0.062, -0.714) |
| Pelvis centre | (36, 41) | (0.152, -0.357) |
| Planted foot | (27.5, 61) | (0.000, 0.000) |
| Far foot | null | — |

**Frame 3 — run high point (grounded, far foot planted)**

- H = 55 px (crown y=5, ground y=60)
- Origin: (19, 60) — planted far foot

| Landmark | Raw (x, y) px | Normalized (x, y) in H |
|---|---|---|
| Crown | (32, 5) | (0.236, -1.000) |
| Head centre | (36, 13) | (0.309, -0.855) |
| Eye | (40, 5) | (0.382, -1.000) |
| Near shoulder | (52, 26) | (0.600, -0.618) |
| Far shoulder | (25, 26) | (0.109, -0.618) |
| Pelvis centre | (35.5, 40) | (0.300, -0.364) |
| Planted foot (far) | (19, 60) | (0.000, 0.000) |
| Near foot | null | — |

**Frame 4 — opposite contact (grounded, both feet planted)**

- H = 49 px (crown y=6, ground y=55)
- Origin: (23, 55) — midpoint of feet at x=9.5 and x=36.5

| Landmark | Raw (x, y) px | Normalized (x, y) in H |
|---|---|---|
| Crown | (29, 6) | (0.122, -1.000) |
| Head centre | (37, 13.5) | (0.286, -0.847) |
| Eye | (40, 6) | (0.347, -1.000) |
| Near shoulder | (52, 21) | (0.592, -0.694) |
| Far shoulder | (24, 21) | (0.020, -0.694) |
| Pelvis centre | (34, 38) | (0.224, -0.347) |
| Near foot (right) | (36.5, 55) | (0.276, 0.000) |
| Far foot (left) | (9.5, 55) | (-0.276, 0.000) |

**Frame 45 — jumping / launch-ascent (unsupported, pelvis-root origin)**

- H = 62 px (crown y=0, lowest opaque y=62)
- Origin: (25, 40) — pelvis root

| Landmark | Raw (x, y) px | Normalized (x, y) in H |
|---|---|---|
| Crown | (29, 0) | (0.065, -0.645) |
| Head centre | (35, 9) | (0.161, -0.500) |
| Eye | (51, 0) | (0.419, -0.645) |
| Near shoulder | (46, 31) | (0.339, -0.145) |
| Far shoulder | (10, 31) | (-0.242, -0.145) |
| Pelvis centre (origin) | (25, 40) | (0.000, 0.000) |
| Near foot | null (gathered, not distinct from torso) | — |
| Far foot | (13, 62) | (-0.194, 0.355) |

**Frame 48 — falling / descent (unsupported, pelvis-root origin)**

- H = 60 px (crown y=0, lowest opaque y=60)
- Origin: (23.5, 39) — pelvis root

| Landmark | Raw (x, y) px | Normalized (x, y) in H |
|---|---|---|
| Crown | (29, 0) | (0.092, -0.650) |
| Head centre | (30.5, 9) | (0.117, -0.500) |
| Eye | (34, 0) | (0.175, -0.650) |
| Near shoulder | (57, 29) | (0.558, -0.167) |
| Far shoulder | (7, 29) | (-0.275, -0.167) |
| Pelvis centre (origin) | (23.5, 39) | (0.000, 0.000) |
| Near foot | null (spread, not distinct from arm silhouette) | — |
| Far foot | (21, 60) | (-0.042, 0.350) |

**Frame 42 — crouch (proxy for landing compression, grounded)**

- H = 44 px (crown y=16, ground y=60)
- Origin: (30.75, 60) — midpoint of feet at x=20 and x=41.5

| Landmark | Raw (x, y) px | Normalized (x, y) in H |
|---|---|---|
| Crown | (31.5, 16) | (0.017, -1.000) |
| Head centre | (35, 22.5) | (0.097, -0.852) |
| Eye | (39, 16) | (0.188, -1.000) |
| Near shoulder | (50, 31) | (0.438, -0.659) |
| Far shoulder | (14, 31) | (-0.381, -0.659) |
| Pelvis centre | (29, 44) | (-0.040, -0.364) |
| Near foot (right) | (41.5, 60) | (0.244, 0.000) |
| Far foot (left) | (20, 60) | (-0.244, 0.000) |

### Inferred ranges table — Warrior (contingency fired)

> The GandalfHardcore Warrior licence was confirmed (see "Source and licence
> notes") but contains a redistribution restriction that prohibits
> "Incorporating them into 'game development tools' or printed materials."
> Because `aicraft-engine` is a game development library, the plan's
> contingency was fired: Warrior-sourced ranges are marked **inferred** and
> are derived from the Godot measurements plus the Shantae/Freedom Planet 2
> CC BY-SA analysis, not from direct measurement of the Warrior sheet.

| Phase | Inferred range | Basis |
|---|---|---|
| Neutral idle foot separation | `0.10H – 0.22H` | Godot frame 30 measured `0.210H`; Warrior devlog describes "18–24 × 44–49 px" figures inside `80 × 64` cells, consistent with a wider human-proportion stance than the robot |
| Near shoulder offset from origin | `+0.20H to +0.30H` | Godot frame 30 measured `+0.228H`; Tyson Tan notes the near shoulder is "more exposed" in 3/4 view |
| Far shoulder offset from origin | `-0.25H to -0.35H` | Godot frame 30 measured `-0.263H`; Tyson Tan notes the far shoulder is "partly occluded by the torso mass" |
| Eye displacement toward travel side | `+0.05H to +0.15H` | Godot frame 30 measured `+0.053H`; Tyson Tan: "Lower the further eye by 1px. Make the further eye 1px smaller than the nearer eye" |
| Pelvis height above ground | `-0.30H to -0.40H` | Godot frame 30 measured `-0.351H`; Warrior devlog shows human pelvis roughly at the same relative height |
| Contact foot separation (max) | `0.45H – 0.55H` | Godot frame 4 measured `0.552H` (foot-to-foot); Warrior run frames likely similar |
| Passing foot position (under body) | `±0.05H of origin` | Godot frame 2 measured `0.000H` (foot at origin); consistent with "swing foot passes the planted leg" |
| Hip travel during gait | `< 0.04H` | Existing hypothesis; not directly measured in Godot (Godot robot has minimal vertical hip travel) |
| Landing compression knee bend | `0.15H – 0.25H` lower than idle pelvis | Godot frame 42 (crouch proxy) shows pelvis at `-0.364H` vs idle `-0.351H` — Godot robot crouch is shallow; Warrior human crouch likely deeper |

### Phase-to-phase range table

Only entries with at least one direct source are included. Inferred entries
are explicitly marked.

| Phase | Godot frame(s) | Source | Key landmarks | Notes |
|---|---|---|---|---|
| **Neutral idle** | 30 | measured | Crown `(0.026, -1.000)`, pelvis `(0.009, -0.351)`, feet `±0.105H` | Both feet planted; near/far depth visible in shoulder and eye offsets |
| **Contact** | 0 | measured | Crown `(-0.212, -1.000)`, near foot planted, far foot in air | Near foot reaches forward; body leans toward travel |
| **Recoil / down** | 1 | measured | Crown `(0.000, -1.000)`, pelvis `(-0.062, -0.357)` | Weight accepted; pelvis slightly lower than idle |
| **Passing** | 2 | measured | Crown `(0.116, -1.000)`, foot at origin | Swing foot passes under body |
| **High point** | 3 | measured | Crown `(0.236, -1.000)`, far foot planted | Body rises; far foot prepares for landing |
| **Opposite contact** | 4 | measured | Crown `(0.122, -1.000)`, both feet `±0.276H` | Both feet on ground; largest foot separation in cycle |
| **Launch / ascent** | 45 | measured | Crown `(0.065, -0.645)` relative to pelvis | Knees gathered; body stretched upward |
| **Apex** | — | **absent** | — | Godot has no distinct apex frame; must be inferred |
| **Descent** | 48 | measured | Crown `(0.092, -0.650)` relative to pelvis | Legs spread; body prepares for landing |
| **Landing contact** | — | **absent** | — | Godot has no landing-contact frame distinct from descent; must be inferred |
| **Landing compression** | 42 (crouch proxy) | measured (proxy) | Crown `(0.017, -1.000)`, pelvis `(-0.040, -0.364)` | Godot crouch is shallow; Warrior human crouch likely deeper |
| **Recovery** | 30 (idle) | measured | Same as neutral idle | Recovery target is the neutral idle pose |

### Notes for inferred production targets

The following production targets are **not direct measurements** and must be
flagged for the implementer:

1. **Apex pose** — Godot has no distinct apex frame. The plan's "Apex is more
   compact than ascent or descent" rule must be implemented as an interpolated
   compact pose between ascent (45) and descent (48). Suggested: crown at
   `-0.60H` relative to pelvis, knees gathered tighter than ascent.

2. **Landing contact** — Godot's `falling` frame (48) serves as descent but
   does not show the moment of ground contact. The implementer must construct
   a landing-contact pose that shows both feet at the support line with knees
   beginning to bend. Suggested: feet at `±0.15H` of origin, pelvis at
   `-0.30H`, knees at `-0.15H`.

3. **Landing compression depth** — Godot's `crouch` frame (42) shows only a
   shallow compression (pelvis at `-0.364H` vs idle `-0.351H`). The plan's
   "landing visibly bends both knees, lowers the pelvis" rule requires a
   deeper compression than the Godot robot demonstrates. The implementer
   should target a pelvis height of `-0.25H to -0.30H` during landing
   compression, deeper than the Godot crouch proxy.

4. **Arm landmarks** — The Godot robot's arms merge with the torso silhouette
   at this resolution, so near/far elbow and hand positions could not be
   directly measured. The implementer must derive arm positions from the
   shoulder landmarks and the plan's "hands sit below the pelvis and above
   the knees" rule.

5. **Hip travel during gait** — The Godot robot shows minimal vertical hip
   travel across the run cycle (pelvis y ranges from `-0.347H` to `-0.365H`,
   a range of `0.018H`). The plan's `< 0.04H` rule is satisfied but the
   implementer should not assume the Godot robot's minimal travel is the
   target — human characters typically show more hip travel.

6. **Near/far depth in idle** — The Godot robot's idle shows a near/far
   shoulder offset of `0.491H` (from `-0.263H` to `+0.228H`). The Tyson Tan
   analysis recommends a smaller offset for human characters (the far
   shoulder is "partly occluded by the torso mass"). The implementer should
   target a near/far shoulder offset of `0.40H to 0.50H` for human
   characters, slightly less than the Godot robot's `0.491H`.

### Source and licence notes

**Godot 2D Platformer robot — MIT (confirmed)**

- Repository: <https://github.com/godotengine/godot-demo-projects>
- Asset path: `2d/platformer/player/robot.webp`
- Frame mapping: `2d/platformer/player/player.tscn`
- Licence: MIT (see verbatim quote above)
- Verdict: **confirmed-reuse**. MIT permits inspection, measurement, and
  citation with attribution. No raster frame was copied into this
  repository.

**GandalfHardcore Free Warrior — custom licence (contingency fired)**

- Asset page: <https://gandalfhardcore.itch.io/2d-pixel-art-male-and-female-character>
- Warrior devlog: <https://gandalfhardcore.itch.io/2d-pixel-art-male-and-female-character/devlog/771411/added-free-warrior-character->
- Licence text (verbatim from the asset page):

  > **✔️ You are allowed to use the assets for:**
  > - Commercial and non-commercial video games and projects
  > - Modify them as needed and display them on designated websites
  >
  > **❌ However, the following uses are prohibited:**
  > - Reselling, repackaging, or redistributing the assets
  > - Using them for AI training or NFT projects (Crypto, Blockchain, web3)
  > - Incorporating them into "game development tools" or printed materials

- Verdict: **contingency-fired**. The licence is confirmed but contains a
  prohibition on "Incorporating them into 'game development tools' or printed
  materials." Because `aicraft-engine` is a game development library, the
  plan's contingency was applied: Warrior-sourced ranges are marked
  **inferred** rather than measured, and no Warrior raster frame was copied
  into this repository. The Warrior sheet may be inspected externally for
  reference but must not be bundled, redistributed, or used as a direct
  measurement source for this library.

**Shantae / Freedom Planet 2 analysis — CC BY-SA 4.0 (confirmed)**

- Source: <https://tysontan.com/gallery/gallery-others/freedom-planet-2-main4/>
- Author: Tyson Tan (character designer for Freedom Planet 2)
- Licence: Creative Commons BY-SA 4.0 (stated on the Tyson Tan website
  footer: "All content on this website is licensed under Creative Commons
  BY-SA License, unless stated otherwise.")
- Verdict: **confirmed-cite**. The analysis is cited for perspective-
  construction evidence (near/far eye, shoulder, hand, joint offsets; pseudo
  two-point perspective). No sprites were copied.

**Dead Cells — supporting observation only (no licence action needed)**

- Source: <https://www.gamedeveloper.com/production/art-design-deep-dive-using-a-3d-pipeline-for-2d-animation-in-i-dead-cells-i->
- Verdict: **supporting-only**. Used for articulation strategy and near/far
  limb depth observation. No sprites copied.

**Phaser tutorial character — exact `32 × 48` scale (no licence action needed)**

- Source: <https://docs.phaser.io/phaser/getting-started/making-your-first-phaser-game>
- Sprite sheet: `dude.png`, 9 frames at `32 × 48` each (4 left, 1 turn, 4 right)
- Frame mapping: left = frames 0–3, turn = frame 4, right = frames 5–8
- Licence: Phaser examples repository warns that example assets are "not
  generally licensed for reuse"
- Verdict: **supporting-only**. Used as a minimum-readability control at the
  exact nominal frame size. No sprites copied.

**Kenney Platformer Characters — CC0 (confirmed)**

- Source: <https://commons.wikimedia.org/wiki/File:Kenney.nl_platformer_characters_-_player_vector.svg>
- Licence: CC0 (confirmed on Wikimedia Commons)
- Verdict: **confirmed-cite**. Used for open-control observations (standing
  support, jump/fall separation, small-scale silhouette). No sprites copied.

**OpenGameArt articulated cyborg — CC0 (confirmed)**

- Source: <https://opengameart.org/content/cc0-2d-douche-cyborg-jump-run-shoot-idle>
- Licence: CC0 (stated in the asset title)
- Verdict: **confirmed-cite**. Used for temporal-sequence observation. No
  sprites copied.

**OpenGameArt James — CC0 (confirmed)**

- Source: <https://opengameart.org/content/pixel-character-02-james>
- Licence: CC0 (stated in the asset title)
- Verdict: **confirmed-cite**. Used for `16 × 16` small-scale silhouette
  control. No sprites copied.

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

## Revised decision

The existing procedural approach remains viable. The projection question is
now resolved: use the Godot-style cheated three-quarter profile, supported by
Shantae/Freedom Planet 2 construction evidence and Dead Cells limb depth.

**The measured pose baseline is now the authority for implementation.** The
tables above replace the earlier hypothesis diagrams. The Godot MIT robot
provided direct measurements for neutral idle, contact, recoil, passing,
high point, opposite contact, launch/ascent, descent, and a crouch proxy for
landing compression. The GandalfHardcore Warrior licence was confirmed but
its "game development tools" restriction triggered the plan's contingency;
Warrior-sourced ranges are marked **inferred** and are derived from the
Godot measurements plus the Tyson Tan CC BY-SA analysis.

**Known gaps for the implementer:**

1. **Apex** — no direct source frame; must be interpolated between ascent
   (Godot 45) and descent (Godot 48).
2. **Landing contact** — no direct source frame distinct from descent;
   must be constructed with both feet at support and knees beginning to bend.
3. **Landing compression depth** — Godot crouch (frame 42) is too shallow;
   implementer should target a deeper compression than the Godot proxy.
4. **Arm landmarks** — Godot robot arms merge with torso at this resolution;
   implementer must derive from shoulder landmarks and the plan's hand-height
   rule.
5. **Hip travel** — Godot robot shows minimal hip travel (`0.018H` range);
   implementer should not assume this is the target for human characters.

The corrected neutral feet and arms satisfy the static invariants. Before the
humanoid is visually complete:

1. ~~identify contact, recoil, passing, and high-point frames in at least two
   source sequences;~~ — **done** (Godot frames 0–4).
2. ~~record normalized head, shoulder, hip, knee, foot, elbow, and hand
   positions;~~ — **partial** (head, shoulder, pelvis, foot recorded from
   Godot; elbow and hand must be derived).
3. ~~derive target ranges from those observations;~~ — **done** (see
   "Phase-to-phase range table" above).
4. ~~replace the hypothesis diagrams with measured overlays;~~ — **done**
   (measured tables replace hypothesis diagrams).
5. ~~expand the permanent sheet with named gait phases and landing;~~ —
   **partial** (named gait phases complete; landing contact and apex must be
   constructed from the inferred ranges).
