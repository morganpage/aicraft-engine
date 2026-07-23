# Turret Shoot-to-Target Aim Widget

> Research note for editor vector handles specifying projectile aim direction and range. Slug: `turret-shoot-to-widget`.
> Investigated: 2026-07-22.

## TL;DR

A "Shoot-to-Target" aim widget provides level designers with an intuitive, interactive vector handle in 2D level editors to specify both the direction (angle) and range (distance) of turret projectiles. By dragging a single handle, designers can visually position the target landing zone, while the editor draws the trajectory path (straight line or parabolic arc) and range boundary. To maintain the library's strict determinism and zero-dependency constraints, we must separate the interactive Canvas2D UI from the headless simulation. We recommend three key patterns for prototyping: (1) **Polar Coordinate Serialization (`angle, range`)** to naturally decouple speed, direction, and lifetime, (2) **Polar Snapping (Independent Angle & Distance Snapping)** to allow precise alignment to 15°/45° increments and grid-unit ranges, and (3) **Polar State Preservation (Zero-Length Handling)** to prevent the loss of direction when the handle is dragged exactly to the turret's center.

## Why this matters for aicraft-engine

- **Pillars Touched**: Directly establishes capabilities for **Pillar 4 (Fake-3D / Level Loading)** level editing, integrates with **Pillar 1 (Primitives / Particles)** for deterministic projectile trajectory rendering, and supports **Pillar 2 (Cosmetics)** by enabling skin-specific turret visual ranges.
- **Consumer Games**: Sibling games like *IMP - Not a Troll* (formerly Spitekeep) and future Clone-to-Jest titles feature turrets, cannons, and hazard-launchers. Level designers need a quick, visual way to define where these hazards shoot without manually typing angles and lifetimes into text fields.
- **Unlocks**:
  - **Visual Trajectory Previews**: Designers can instantly see the exact path and maximum reach of a projectile inside the editor, eliminating the tedious cycle of "guess value, playtest, adjust, repeat."
  - **Deterministic Lifetime Resolution**: By mapping the handle's distance to a projectile speed, the runtime can calculate the exact tick count at which the projectile should expire, guaranteeing identical behavior across all host environments.
  - **Compact Level Representation**: Storing aim vectors as polar coordinates keeps level JSON files extremely small, making them easy to share via short text codes or URL query parameters.

---

## Prior Art Survey

### Pattern 1: Unity-Style Handles & Godot Editor Plugins
- **Source**: Unity `Handles.RadiusHandle` / `Handles.FreeMoveHandle` ([docs.unity3d.com/ScriptReference/Handles.html](https://docs.unity3d.com/ScriptReference/Handles.html)) & Godot `EditorPlugin._forward_canvas_gui_input` ([docs.godotengine.org/en/stable/classes/class_editorplugin.html](https://docs.godotengine.org/en/stable/classes/class_editorplugin.html))
- **What it does**: Unity and Godot provide specialized editor APIs to draw interactive 2D/3D handles in the scene view. For a turret, they draw a circular range handle and a directional arrow. Clicking and dragging the handle projects the mouse position into the scene, updating the underlying serialized properties.
- **Algorithmic shape**:
  ```typescript
  export interface ViewportHandle {
    readonly id: string;
    readonly x: number; // Screen space or world space X
    readonly y: number; // Screen space or world space Y
    readonly radius: number; // Click hit-box radius
  }

  export function isMouseOverHandle(mx: number, my: number, h: ViewportHandle): boolean {
    const dx = mx - h.x;
    const dy = my - h.y;
    return (dx * dx + dy * dy) <= h.radius * h.radius;
  }
  ```
- **Determinism profile**: Pure mathematical hit-testing. Fully deterministic.
- **Runtime cost**: Extremely low. Hit-testing is a simple distance check.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. We can implement a lightweight, headless equivalent in TypeScript that takes mouse coordinates and returns active handle states, which can then be rendered in Canvas2D.
- **What to steal**: The concept of drawing a faint range boundary circle combined with a distinct interactive handle node at the tip of the vector.
- **What to avoid**: Avoid coupling the handle logic to engine-specific UI frameworks or input systems; keep the coordinate math pure and headless.

---

### Pattern 2: Polar Coordinate Serialization (`angle, range`)
- **Source**: Standard Vector Math & LDTK Custom Fields ([ldtk.org/json/](https://ldtk.org/json/))
- **What it does**: Instead of storing the handle's absolute position `(hx, hy)` or relative Cartesian offset `(dx, dy)`, the entity serializes its aim vector in polar coordinates: `angle` (in radians or degrees) and `range` (in pixels or grid units).
- **Algorithmic shape**:
  ```typescript
  export interface PolarVector {
    readonly angle: number; // Radians, standard Cartesian (0 is right, clockwise)
    readonly range: number; // Pixels or grid units
  }

  export function polarToCartesian(cx: number, cy: number, p: PolarVector): { x: number; y: number } {
    return {
      x: cx + p.range * Math.cos(p.angle),
      y: cy + p.range * Math.sin(p.angle)
    };
  }

  export function cartesianToPolar(cx: number, cy: number, hx: number, hy: number): PolarVector {
    const dx = hx - cx;
    const dy = hy - cy;
    return {
      angle: Math.atan2(dy, dx),
      range: Math.sqrt(dx * dx + dy * dy)
    };
  }
  ```
- **Determinism profile**: Pure. Fully deterministic.
- **Runtime cost**: Negligible. Uses basic trigonometric functions (`cos`, `sin`, `atan2`, `sqrt`).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Polar coordinates naturally separate direction and range, which is highly semantic and matches the physical parameters of turrets.
- **What to steal**: Serializing `angle` and `range` in the level schema rather than raw handle coordinates. This ensures that if the turret entity is moved, the aim vector automatically moves with it without needing to update the handle coordinates.
- **What to avoid**: Avoid storing absolute handle coordinates in the level file, which causes the aim vector to stretch or break when the parent entity is moved.

---

### Pattern 3: Polar Snapping (Independent Angle & Distance Snapping)
- **Source**: Figma Smart Guides & Vector Drawing Editors
- **What it does**: Level designers need precise control over angles (e.g., shooting exactly horizontal, vertical, or at 45°) and ranges (e.g., shooting exactly 5 tiles far). Polar snapping snaps the angle and range independently during dragging, rather than snapping the mouse to a Cartesian grid.
- **Algorithmic shape**:
  ```typescript
  export function snapPolar(
    rawAngle: number,
    rawRange: number,
    angleStep: number | null, // e.g., Math.PI / 12 for 15 degrees, or null for free
    rangeStep: number | null  // e.g., 16 pixels (1 tile), or null for free
  ): PolarVector {
    let angle = rawAngle;
    let range = rawRange;

    if (angleStep !== null) {
      // Normalize angle to [0, 2*PI]
      const normalized = (angle % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      angle = Math.round(normalized / angleStep) * angleStep;
    }

    if (rangeStep !== null) {
      range = Math.round(range / rangeStep) * rangeStep;
    }

    return { angle, range };
  }
  ```
- **Determinism profile**: Pure. Fully deterministic.
- **Runtime cost**: Low. Basic arithmetic operations.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Provides clean, professional editor alignment without dragging in heavy spatial libraries.
- **What to steal**: Snapping the angle to common increments (15°, 45°, 90°) and the range to grid-tile increments independently. This is much more intuitive than Cartesian snapping, which distorts angles at arbitrary distances.
- **What to avoid**: Avoid snapping the handle directly to the 2D Cartesian grid, as this makes it mathematically impossible to achieve precise angles like exactly 30° or 45° unless the distance happens to form a Pythagorean triple.

---

### Pattern 4: Polar State Preservation (Zero-Length Handling)
- **Source**: GameMaker Studio & Custom 2D Level Editors
- **What it does**: When a user drags the handle exactly to the turret's center `(cx, cy)`, the distance becomes 0. In Cartesian space, `dx = 0, dy = 0` causes `atan2(0, 0)` to become undefined (or 0), destroying the turret's original aim angle. When the user drags the handle back out, the turret is stuck facing right. Polar state preservation solves this by clamping the minimum range or preserving the last valid angle.
- **Algorithmic shape**:
  ```typescript
  // Option A: Minimum Range Clamp
  export function clampPolarRange(p: PolarVector, minRange: number): PolarVector {
    return {
      angle: p.angle,
      range: Math.max(minRange, p.range)
    };
  }

  // Option B: Transient Angle Cache (State Preservation)
  export interface DragState {
    readonly isDragging: boolean;
    readonly lastValidAngle: number;
  }

  export function handleDragUpdate(
    cx: number,
    cy: number,
    mx: number,
    my: number,
    state: DragState,
    minThreshold: number = 4
  ): { vector: PolarVector; nextState: DragState } {
    const dx = mx - cx;
    const dy = my - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < minThreshold) {
      // Range is too small; set range to 0 but preserve the last valid angle
      return {
        vector: { angle: state.lastValidAngle, range: 0 },
        nextState: state
      };
    }

    const angle = Math.atan2(dy, dx);
    return {
      vector: { angle, range: dist },
      nextState: { isDragging: true, lastValidAngle: angle }
    };
  }
  ```
- **Determinism profile**: Pure state transition. Fully deterministic.
- **Runtime cost**: Negligible.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Solves a major UX papercut in level editors using simple, robust state management.
- **What to steal**: Preserving the `angle` property even when `range` is set to 0, or enforcing a minimum range clamp (e.g., half a tile) so the handle can never overlap the turret's center.
- **What to avoid**: Avoid letting the serialized angle reset to 0 or undefined when the range is 0, which frustrates level designers who want to temporarily disable a turret's range without losing its aim direction.

---

### Pattern 5: Headless Ballistic Mapping (Decoupled UI-to-Runtime)
- **Source**: *Celeste* (Spike/Turret logic) & *Super Mario Maker*
- **What it does**: Decouples the visual editor widget from the runtime simulation. The editor core only manages the serialized `angle` and `range` properties. The runtime physics engine reads these properties and calculates the projectile's trajectory and lifetime deterministically, without knowing anything about Canvas2D, mouse events, or handles.
- **Algorithmic shape**:
  ```typescript
  // RUNTIME SIMULATION (Pure, deterministic, zero-dependency)
  export interface Projectile {
    x: number;
    y: number;
    vx: number;
    vy: number;
    ticksElapsed: number;
    maxTicks: number;
  }

  export function spawnProjectile(
    cx: number,
    cy: number,
    angle: number,
    range: number,
    speed: number, // Pixels per second
    dt: number     // Time step (e.g., 1 / 60)
  ): Projectile {
    const vx = speed * Math.cos(angle);
    const vy = speed * Math.sin(angle);
    
    // Calculate exact lifetime in ticks to reach maximum range
    const lifetimeSeconds = range / speed;
    const maxTicks = Math.ceil(lifetimeSeconds / dt);

    return {
      x: cx,
      y: cy,
      vx,
      vy,
      ticksElapsed: 0,
      maxTicks
    };
  }

  export function updateProjectile(p: Projectile, dt: number): { active: boolean } {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.ticksElapsed++;

    const active = p.ticksElapsed < p.maxTicks;
    return { active };
  }
  ```
- **Determinism profile**: Pure. Fully deterministic.
- **Runtime cost**: Low. Simple linear updates per tick.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Ensures that the simulation runs identically in tests, headless servers, and client browsers, completely decoupled from the editor UI.
- **What to steal**: Mapping the visual `range` directly to a deterministic projectile `maxTicks` lifetime based on constant speed and time step `dt`.
- **What to avoid**: Avoid running the actual physics simulation inside the editor UI to draw the trajectory line; instead, use the same mathematical equations to draw a static preview line.

---

## Reference Implementations

- **Unity 2D Editor Handles** ([GitHub: Unity-Technologies/UnityCsReference](https://github.com/Unity-Technologies/UnityCsReference)): Shows how Unity separates editor-only GUI handles from scene components.
- **Godot Editor Gizmos** ([GitHub: godotengine/godot](https://github.com/godotengine/godot)): Demonstrates 2D viewport handle drawing and input event interception.
- **Aseprite Vector Tools** ([GitHub: aseprite/aseprite](https://github.com/aseprite/aseprite)): Illustrates polar coordinate snapping and angle constraints in 2D editors.
- **IMP - Not a Troll Projectile Core** (`src/particles/`): The local sibling module that manages deterministic particle updates, which can be extended to support range-limited projectiles.

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| Unity 2D Radius & Position Handles | Interactive circular range boundary and directional handles drawn in the editor viewport. | [Unity Editor Handles](https://docs.unity3d.com/ScriptReference/Handles.html) |
| Godot 2D Viewport Gizmos | Custom control point handles for editing properties directly in the 2D scene view. | [Godot EditorPlugin](https://docs.godotengine.org/en/stable/classes/class_editorplugin.html) |
| Aseprite Polar Line Tool | Precise angle snapping (15°/45°/90°) and distance constraints during visual line drawing. | [Aseprite Drawing Tools](https://aseprite.org) |

## Architecture Flow

The following diagram illustrates how the interactive Canvas2D editor widget maps to the serialized polar coordinates, and how the runtime simulation consumes them:

```
EDITOR VIEWPORT (Canvas2D UI)
┌────────────────────────────────────────────────────────┐
│                                                        │
│             Turret                                     │
│             (cx, cy)                                   │
│                ◎ ─────────────────────────┐            │
│                │ ╲   Faint Range Circle   │            │
│                │   ╲                      │            │
│                │     ╲                    │            │
│                │       ╲                  │            │
│                │         ╲  Aim Vector    │            │
│                │           ╲              │            │
│                │             ╲            │            │
│                │               ╲          │            │
│                └─────────────────◎────────┘            │
│                                Handle                  │
│                                (hx, hy)                │
│                                                        │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼ (Mouse Drag / Snap)
┌────────────────────────────────────────────────────────┐
│ Editor Core State (Headless)                           │
│ 1. Calculates: dx = hx - cx, dy = hy - cy              │
│ 2. Computes: angle = atan2(dy, dx), range = sqrt(dx^2 + dy^2)
│ 3. Applies Polar Snapping (e.g., 45° angle, 16px range)│
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼ (Save / Serialize)
┌────────────────────────────────────────────────────────┐
│ Serialized Level JSON (Compact & Versioned)            │
│ {                                                      │
│   "type": "turret",                                    │
│   "x": 128, "y": 64,                                   │
│   "aimAngle": 0.7854,  // 45 degrees in radians        │
│   "aimRange": 160.0    // 10 tiles range (16px/tile)   │
│ }                                                      │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼ (Load / Play)
┌────────────────────────────────────────────────────────┐
│ Runtime Simulation (Deterministic & Headless)          │
│ 1. Reads: aimAngle, aimRange, speed = 200px/s, dt = 1/60
│ 2. Computes: vx = 200 * cos(0.7854), vy = 200 * sin(0.7854)
│ 3. Computes: maxTicks = ceil(160 / (200 * (1/60))) = 48
│ 4. Advances projectile by (vx*dt, vy*dt) for 48 ticks  │
└────────────────────────────────────────────────────────┘
```

---

## Open Questions

- **Parabolic Trajectories (Gravity-Affected Projectiles)**:
  If a turret shoots projectiles affected by gravity, a straight-line range is insufficient. How should the widget handle parabolic arcs?
  *Draft Answer*: The handle `(hx, hy)` should represent the target landing point. The runtime simulation can solve the ballistic trajectory equations to find the required launch velocity and angle, or the editor can draw a parabolic preview curve using the standard kinematic equation: $y(t) = y_0 + v_{0y}t - \frac{1}{2}gt^2$.
- **Visual Range Customization**:
  Should the range boundary circle be drawn as a solid line, a dashed line, or a shaded circle?
  *Draft Answer*: A dashed, semi-transparent circle with a low alpha value (e.g., `rgba(255, 255, 255, 0.15)`) is standard. It provides clear spatial feedback without cluttering the level editor's viewport.
- **Multi-Select Vector Adjustments**:
  If a designer selects multiple turrets, should dragging the handle adjust all of them?
  *Draft Answer*: Yes. The editor core can calculate the delta angle and delta range from the active turret being dragged, and apply those relative deltas to all other selected turrets, preserving their individual relative orientations.

---

## Top 3 Patterns Worth Prototyping

1. **Polar Coordinate Serializer & Cartesian Converter** — Prototyping pure, zero-dependency utility functions (`polarToCartesian` and `cartesianToPolar`) that handle conversions, coordinate offsets, and safe trigonometric operations.
2. **Polar Snapper (Angle & Distance)** — Prototyping an independent polar snapping function that takes raw angles and distances, applying configurable angle increments (e.g., 15°/45°) and range increments (e.g., 8px/16px) to return clean, aligned values.
3. **Polar State Preserving Drag Handler** — Prototyping a headless drag-state manager that handles mouse coordinates relative to a turret's center, enforcing a minimum range clamp or caching the last valid angle to prevent direction loss at zero-length.

---

## Cross-References

- `docs/architecture.md` (layer separation, determinism rules, and pure progression ops)
- `docs/conventions.md` (code style rules, naming patterns, and pure progression ops)
- `docs/research/editor-core.md` (headless level-editor state, undo/redo, and selection models)
- `docs/research/level-schema.md` (level serialization, versioning, and defensive parsing)
- `src/particles/` (deterministic particle/projectile simulation core)
