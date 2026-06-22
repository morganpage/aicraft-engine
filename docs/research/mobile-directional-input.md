# Mobile Directional Input

> Research note for on-screen directional input for mobile games — virtual D-pads, analog thumbsticks, and how they integrate with a binary edge-accumulator input model. Slug: `mobile-directional-input`.
> Investigated: 2026-06-22.

## TL;DR

To support mobile web gameplay (Poki, CrazyGames, and Spitekeep mobile) within a zero-dependency TypeScript Canvas2D library, we must bridge the gap between continuous/multi-touch screen interactions and the engine's deterministic binary edge-accumulator core (`edges.ts`). Virtual directional inputs must handle multi-touch pointer tracking (isolating pointer IDs to prevent cross-talk between left-thumb steering and right-thumb jumping) and resolve host APIs defensively. Prototyping should focus on: (1) a **Composite Virtual D-Pad** that wraps discrete DOM elements using the existing `createTouchButton` and `orEdges` helpers, (2) an **Analog Virtual Thumbstick** that tracks dynamic/floating pointer origins and thresholds a continuous 2D vector into binary directional edges, and (3) a **Canvas-Wide Pointer-Region Hit-Tester** that avoids DOM overhead entirely by dividing the canvas viewport into touch zones.

## Why this matters for aicraft-engine

This technique directly touches **Pillar 1 (Primitives & secondary dynamics)** and **Pillar 4 (Fake-3D & advanced rendering)**.
- **Mobile Web Accessibility:** Minimalist procedural games (Sokpop-style) are highly popular on mobile web portals like Poki and CrazyGames. Without a built-in virtual directional input abstraction, mobile players cannot play these games unless the consumer hand-builds custom DOM overlays and manually wires them into the engine's edge-accumulators.
- **Multi-Touch Robustness:** In a 2D platformer or top-down action game, a player must be able to hold a directional input (e.g., "right") with one thumb while tapping action buttons (e.g., "jump") with the other thumb. Managing multi-touch pointer IDs defensively is a notoriously error-prone task for game developers; providing a robust, tested abstraction in the engine eliminates a massive category of mobile-input bugs.
- **Composition with the Edge Core:** The engine's core input layer (`edges.ts`) utilizes a binary latching model (`EdgeAccumulator { held, pressedSincePoll, releasedSincePoll }`). Directional touch controls must seamlessly translate continuous pointer coordinates into these discrete binary edges without introducing input lag, stuck states, or desynchronization.

---

## Prior Art Survey

### Pattern 1: Discrete Virtual D-Pad (Arrow Buttons)
- **Source**: Phaser Virtual Joystick Plugin (discrete mode), Kontra.js touch controls, and JS13k mobile entries.
- **What it does**: Renders 4 discrete directional buttons (Up, Down, Left, Right) as styled DOM elements or canvas regions. Each button acts as an independent touch sensor.
- **Algorithmic shape**:
  ```typescript
  // Discrete D-Pad maps 4 separate buttons to 4 EdgeAccumulators
  interface DiscreteDpad {
    up: EdgeAccumulator;
    down: EdgeAccumulator;
    left: EdgeAccumulator;
    right: EdgeAccumulator;
  }
  ```
- **Determinism profile**: Host-touching. The pointer event listeners are bound to the DOM elements, which in turn mutate the deterministic in-memory `EdgeAccumulator` buffers via `pressEdge` and `releaseEdge`.
- **Runtime cost**: Extremely low. Browser handles hit-testing natively via DOM pointer events. No per-frame mathematical calculations are required.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Composes directly with the engine's existing `createTouchButton` adapter and `orEdges` merge helper.
- **What to steal**: The simplicity of mapping individual buttons directly to logical actions. It is highly accessible (DOM elements can have ARIA labels) and easy to style using standard CSS.
- **What to avoid**: Poor thumb-reach ergonomics. If the buttons are too small or spaced too far apart, players will frequently miss them. Additionally, standard DOM buttons do not support "sliding" (e.g., sliding your thumb from Left to Right without lifting it will not trigger the Right button unless custom multi-element tracking is implemented).

### Pattern 2: Analog Virtual Thumbstick (Draggable Knob)
- **Source**: NippleJS, Phaser Virtual Joystick Plugin, and classic mobile action games.
- **What it does**: Consists of a static or dynamic base ring and a draggable inner knob. It tracks a single pointer, computes a continuous 2D vector relative to the base center, clamps the magnitude to a maximum radius, and applies a dead-zone threshold.
- **Algorithmic shape**:
  ```typescript
  interface ThumbstickState {
    activePointerId: number | null;
    originX: number; // Center of base ring
    originY: number;
    knobX: number;   // Current pointer position
    knobY: number;
    vectorX: number; // Normalized [-1.0, 1.0]
    vectorY: number; // Normalized [-1.0, 1.0]
  }
  ```
- **Determinism profile**: Hybrid. The pointer event capture is host-touching, but the vector normalization, clamping, dead-zone math, and threshold-to-edge conversions are pure mathematical operations that are 100% deterministic and unit-testable.
- **Runtime cost**: Low. Requires basic 2D vector math (distance, angle, normalization) on `pointermove` events.
- **Dependencies**: None.
- **Fit for our constraints**: Medium-Strong. It offers superior ergonomics for mobile players but introduces the complexity of mapping continuous analog values onto the engine's binary edge model.
- **What to steal**: The "floating/dynamic" origin pattern (the thumbstick base appears wherever the user first touches on the left half of the screen, reducing thumb strain). The return-to-center spring physics when the touch is released.
- **What to avoid**: High visual complexity and heavy DOM reflows. If the knob's visual position is updated by mutating DOM style properties (`top`/`left`) on every frame, it can cause severe performance degradation on low-end mobile devices. Visual updates should instead use CSS transforms (`translate3d`) or be rendered directly on the Canvas.

### Pattern 3: Pointer-Region / On-Canvas Hit Zones
- **Source**: JS13k games (e.g., *Phobos*, *Space Hug*), and minimalist HTML5 canvas games.
- **What it does**: Divides the game canvas viewport into invisible logical hit regions (e.g., left 25% of screen = Move Left, next 25% = Move Right, right 50% = Jump). It intercepts all pointer events on the canvas and performs manual hit-testing.
- **Algorithmic shape**:
  ```typescript
  function processCanvasTouch(pointerX: number, canvasWidth: number): string {
    if (pointerX < canvasWidth * 0.25) return 'left';
    if (pointerX < canvasWidth * 0.50) return 'right';
    return 'jump';
  }
  ```
- **Determinism profile**: Host-touching. Reads canvas dimensions and pointer coordinates, then feeds the deterministic edge core.
- **Runtime cost**: Extremely low. Requires only simple coordinate thresholding.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Avoids creating any DOM elements, making it extremely lightweight and perfect for full-screen canvas-only games.
- **What to steal**: Zero DOM overhead. It is highly performant and extremely easy to implement.
- **What to avoid**: Complete lack of accessibility (screen readers cannot detect canvas hit zones) and lack of visual feedback (unless the game explicitly draws the buttons on the canvas, which fights Device Pixel Ratio scaling and increases rendering code complexity). It also conflicts with in-game canvas interactions like clicking menus or dragging entities.

### Pattern 4: 8-Way / Hybrid D-Pad
- **Source**: Retro console emulators (e.g., RetroArch web, NESbox) and top-down mobile arcade games.
- **What it does**: A single circular D-pad element that detects 8 discrete directions (Up, Down, Left, Right, and the 4 diagonals) based on the angle of the touch relative to the center of the pad.
- **Algorithmic shape**:
  ```typescript
  // Map angle to 8 sectors of 45 degrees each
  function get8WayDirection(dx: number, dy: number): string[] {
    const angle = Math.atan2(dy, dx); // [-PI, PI]
    // Map angle to discrete actions: ['left'], ['left', 'up'], etc.
  }
  ```
- **Determinism profile**: Host-touching.
- **Runtime cost**: Low. Uses basic trigonometry (`Math.atan2`).
- **Dependencies**: None.
- **Fit for our constraints**: Medium. Highly useful for top-down or isometric games (Pillar 4), but overkill for simple 2D side-scrolling platformers (like Spitekeep).
- **What to steal**: The angle-sector mapping technique, which allows a single DOM element or canvas region to drive multiple directional accumulators simultaneously (e.g., touching the top-right sector presses both "up" and "right").
- **What to avoid**: Dead-zones where the player's thumb sits on the boundary between sectors, causing rapid flickering between inputs.

---

## Multi-Touch and Pointer Event Tracking

The single most critical requirement for a mobile input system is **robust multi-touch tracking**. In a typical desktop game, keyboard events are global. On mobile, touch events are pointer-specific. 

If a player holds "right" with their left thumb and taps "jump" with their right thumb, the browser fires separate events. If the input system does not track pointer IDs, several catastrophic bugs can occur:
1. **The Overwrite Bug**: Tapping "jump" (Pointer 2) fires a `pointerup` on the screen, which incorrectly clears the "right" (Pointer 1) held state because the code simply listens to global `pointerup` events.
2. **The Stuck-Key Bug**: If the player slides their left thumb off the D-pad while holding jump, a global `pointerleave` might reset all inputs, or a missed `pointerup` might leave the character running right indefinitely.

### The Solution: Pointer ID Tracking
Pointer Events (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`) provide a unique `pointerId` for every active touch. A robust mobile input adapter must track these IDs:

- **For Discrete Buttons**: Each button must lock onto the `pointerId` that initiated the `pointerdown` event. It must ignore all other pointer events except those matching that `pointerId`, releasing the edge only when that specific pointer is lifted (`pointerup`) or cancelled.
- **For Joysticks**: The joystick base must capture the `pointerId` on `pointerdown`. Subsequent `pointermove` events must only update the joystick vector if their `pointerId` matches the captured ID.

---

## Visual Rendering: Canvas vs. DOM

When designing virtual controls, we face a fundamental architectural choice: should the controls be rendered in the HTML DOM (via styled divs) or drawn directly onto the WebGL/Canvas2D surface?

| Dimension | DOM-Rendered (HTML/CSS) | Canvas-Rendered (Canvas2D) |
|---|---|---|
| **Styling & Themes** | **Excellent.** Styled via CSS, supports transitions, borders, shadows, and easy palette substitution. | **Poor.** Must be drawn manually using Canvas paths, fills, and strokes. Theme changes require re-drawing. |
| **DPR & Resolution** | **Perfect.** Handled automatically by the browser's layout engine. Sharp at any zoom. | **Difficult.** Must be manually scaled by the Device Pixel Ratio (DPR) to avoid blurriness. |
| **Accessibility** | **Excellent.** Can use semantic HTML, ARIA roles, and screen-reader accessible labels. | **None.** Completely invisible to screen readers and accessibility tools. |
| **Performance** | **Medium.** Can cause layout reflows if styled poorly. Best with absolute positioning and CSS transforms. | **High.** Zero DOM overhead. Drawn in the same render pass as the game. |
| **Input Capture** | **Native.** Pointer events map directly to the element's bounding box. | **Manual.** Requires coordinate translation from screen-space to canvas-space. |

### Synthesis for `aicraft-engine`
Given our **defensive-adapter design philosophy** (lazy host resolution, swallow errors, never-throw), **DOM-rendered controls** are the superior default. They align perfectly with the existing `touch-button.ts` implementation, leverage native browser hit-testing, and provide excellent accessibility. However, the engine should also expose the raw mathematical helpers (vector calculations, dead-zone clamping, and thresholding) so that advanced consumers can build canvas-rendered controls if they choose.

---

## Analog-to-Digital Thresholding

Because the engine's core simulation consumes binary edges (`PolledEdge`), an analog virtual thumbstick's continuous 2D vector `(vx, vy) ∈ [-1, 1]²` must be thresholded into discrete binary states.

### Thresholding Strategies

1. **Simple Axis Thresholding**:
   - If $vx > 0.5$, trigger `pressEdge(right)`. If $vx \le 0.5$, trigger `releaseEdge(right)`.
   - If $vx < -0.5$, trigger `pressEdge(left)`. If $vx \ge -0.5$, trigger `releaseEdge(left)`.
   - *Pros*: Extremely simple to implement.
   - *Cons*: Lacks diagonal precision. In a platformer, a slight diagonal tilt might accidentally trigger an upward climb or jump depending on the mapping.

2. **Radial Sector Thresholding**:
   - Divide the 360-degree space into angular zones.
   - If the vector magnitude exceeds a dead-zone (e.g., $magnitude > 0.3$):
     - Angle $\theta \in [-22.5^\circ, 22.5^\circ] \implies$ Right.
     - Angle $\theta \in [67.5^\circ, 112.5^\circ] \implies$ Down.
     - Angle $\theta \in [112.5^\circ, 157.5^\circ] \implies$ Down-Left (triggers both Left and Down).
   - *Pros*: Highly ergonomic and prevents accidental diagonal misfires.
   - *Cons*: Requires trigonometric functions (`Math.atan2`, `Math.sqrt`) on every move event.

3. **Dual-Model Exposure (The Hybrid Solution)**:
   - The thumbstick adapter maintains both a record of thresholded binary `PolledEdge`s (for standard platformer movement) AND the raw normalized `(vx, vy)` vector.
   - This keeps the adapter compatible with the existing binary edge core while unlocking continuous analog movement for top-down games that support variable speed or 360-degree steering.

---

## Algorithmic Shape

### Pattern 1: Multi-Touch Discrete Button (Refining `touch-button.ts`)
To support true multi-touch without cross-talk, the discrete button must track `pointerId` explicitly:

```typescript
// Pure mathematical/logical state for a single pointer-locked button
export interface TouchButtonState {
  activePointerId: number | null;
  accumulator: EdgeAccumulator;
}

// Host-touching defensive adapter
export function createMultiTouchButton(element: HTMLElement | null): TouchButtonAdapter {
  if (!element) return { poll: () => IDLE_EDGE, dispose: () => {} };

  const acc = createEdgeAccumulator();
  let activePointerId: number | null = null;
  let disposed = false;

  const onPointerDown = (e: PointerEvent): void => {
    // Lock onto the first pointer that touches this element
    if (activePointerId !== null) return;
    activePointerId = e.pointerId;
    
    try {
      element.setPointerCapture(e.pointerId);
    } catch {
      // setPointerCapture can fail in some environments; swallow defensively
    }
    pressEdge(acc);
  };

  const onPointerUp = (e: PointerEvent): void => {
    // Only release if the pointer matches the locked ID
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    releaseEdge(acc);
  };

  try {
    element.style.touchAction = 'none';
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerUp);
  } catch {
    // Swallow defensively
  }

  return {
    poll: () => pollEdge(acc),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      try {
        element.removeEventListener('pointerdown', onPointerDown);
        element.removeEventListener('pointerup', onPointerUp);
        element.removeEventListener('pointercancel', onPointerUp);
      } catch {}
    }
  };
}
```

### Pattern 2: Analog Thumbstick with Thresholded Output
A defensive, zero-dependency virtual thumbstick that supports floating origins and outputs both a continuous vector and thresholded binary edges.

```typescript
export interface ThumbstickAdapter {
  poll(): {
    vector: { x: number; y: number };
    edges: {
      left: PolledEdge;
      right: PolledEdge;
      up: PolledEdge;
      down: PolledEdge;
    };
  };
  dispose(): void;
}

export interface ThumbstickConfig {
  deadZone: number;     // e.g., 0.15 (ignore tiny movements)
  threshold: number;    // e.g., 0.50 (magnitude to trigger binary edge)
  maxRadius: number;    // e.g., 50 (pixels of maximum drag)
  floating: boolean;    // If true, base moves to initial touch position
}

export function createVirtualThumbstick(
  container: HTMLElement | null,
  config: ThumbstickConfig
): ThumbstickAdapter {
  if (!container) {
    return {
      poll: () => ({ vector: { x: 0, y: 0 }, edges: { left: IDLE, right: IDLE, up: IDLE, down: IDLE } }),
      dispose: () => {}
    };
  }

  // Deterministic core state
  const leftAcc = createEdgeAccumulator();
  const rightAcc = createEdgeAccumulator();
  const upAcc = createEdgeAccumulator();
  const downAcc = createEdgeAccumulator();
  
  let activePointerId: number | null = null;
  let startX = 0; // Origin center
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let vx = 0; // Normalized vector output
  let vy = 0;

  const onDown = (e: PointerEvent): void => {
    if (activePointerId !== null) return;
    activePointerId = e.pointerId;
    
    const rect = container.getBoundingClientRect();
    if (config.floating) {
      startX = e.clientX - rect.left;
      startY = e.clientY - rect.top;
    } else {
      startX = rect.width / 2;
      startY = rect.height / 2;
    }
    currentX = e.clientX - rect.left;
    currentY = e.clientY - rect.top;
    
    updateVector();
  };

  const onMove = (e: PointerEvent): void => {
    if (e.pointerId !== activePointerId) return;
    const rect = container.getBoundingClientRect();
    currentX = e.clientX - rect.left;
    currentY = e.clientY - rect.top;
    
    updateVector();
  };

  const onUp = (e: PointerEvent): void => {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    vx = 0;
    vy = 0;
    
    // Reset all accumulators to idle
    resetEdge(leftAcc);
    resetEdge(rightAcc);
    resetEdge(upAcc);
    resetEdge(downAcc);
  };

  // Pure, deterministic vector and threshold math
  function updateVector(): void {
    const dx = currentX - startX;
    const dy = currentY - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist < config.maxRadius * config.deadZone) {
      vx = 0;
      vy = 0;
    } else {
      const angle = Math.atan2(dy, dx);
      const clampedDist = Math.min(dist, config.maxRadius);
      // Normalize to [-1, 1]
      const normalizedMag = clampedDist / config.maxRadius;
      vx = Math.cos(angle) * normalizedMag;
      vy = Math.sin(angle) * normalizedMag;
    }

    // Threshold into binary edge accumulators
    updateEdge(vx, -config.threshold, leftAcc);
    updateEdge(vx, config.threshold, rightAcc);
    updateEdge(vy, -config.threshold, upAcc);
    updateEdge(vy, config.threshold, downAcc);
  }

  function updateEdge(value: number, threshold: number, acc: EdgeAccumulator): void {
    const isTriggered = threshold < 0 ? value < threshold : value > threshold;
    if (isTriggered) {
      if (!acc.held) pressEdge(acc);
    } else {
      if (acc.held) releaseEdge(acc);
    }
  }

  // Wire event listeners defensively...
  return {
    poll() {
      return {
        vector: { x: vx, y: vy },
        edges: {
          left: pollEdge(leftAcc),
          right: pollEdge(rightAcc),
          up: pollEdge(upAcc),
          down: pollEdge(downAcc)
        }
      };
    },
    dispose() { /* teardown listeners */ }
  };
}
```

---

## Determinism / Layering Profile

The virtual directional input system adheres strictly to the library's architecture:

1. **Host-Touching Layer (DOM / Pointer Events)**:
   - Listens to DOM pointer events, manages pointer capture, and tracks `pointerId`.
   - Resolves `window` and element bounds lazily at call time.
   - Swallows all errors defensively and falls back to no-op adapters in SSR/Node.
2. **Deterministic Core Layer (Vector Math & Thresholding)**:
   - The vector calculations, dead-zone clamping, angular sector mapping, and edge-latching logic are pure, side-effect-free mathematical operations.
   - This core logic can be extracted and fully unit-tested in Node/vitest by feeding mock coordinates into the update functions, ensuring 100% determinism.

---

## Reference Implementations

1. **Phaser 3 Virtual Joystick Plugin**
   - *Source*: `https://github.com/rexrainbow/phaser3-rex-notes/tree/master/plugins/virtualjoystick`
   - *Description*: Industry-standard virtual joystick implementation for Phaser. Demonstrates floating/static modes, vector calculations, and keyboard-mapping emulation.
2. **NippleJS**
   - *Source*: `https://github.com/yoannmoinet/nipplejs`
   - *Description*: The most popular standalone virtual joystick library for touch devices. Excellent reference for multi-touch pointer tracking and CSS-based visual styling.
3. **aicraft-engine `touch-button.ts`**
   - *Path*: `src/input/touch-button.ts`
   - *Description*: Local reference for defensive DOM pointer-event adapters.
4. **aicraft-engine `edges.ts`**
   - *Path*: `src/input/edges.ts`
   - *Description*: Local reference for the deterministic binary edge-accumulator core.

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| Discrete D-Pad Overlay | 4 arrow buttons arranged in a cross on the bottom-left of the screen, styled with semi-transparent CSS. | RetroArch Web Player |
| Floating Analog Joystick | A base ring that appears under the thumb's initial touch point, with a knob that slides up to a maximum radius. | NippleJS Demo |
| Canvas Hit Regions | Invisible vertical lines dividing the screen into left/right movement zones and a right-side jump zone. | JS13k Mobile Entries (*Phobos*) |

---

## Open Questions

1. **Should the D-pad be a new abstraction or a documented composite of existing adapters?**
   - *Context*: A discrete D-pad can be built today by calling `createTouchButton` 4 times and merging them.
   - *Design Choice*: To avoid premature generalization and maintain scope discipline, we should prefer documenting how to compose existing primitives first, or provide a lightweight composite helper `createVirtualDpad` that automates the boilerplate.
2. **How should we handle visual rendering of the thumbstick?**
   - *Context*: Drawing the thumbstick on the canvas requires the engine to manage visual assets or render circles, which fights DPR scaling. Rendering in the DOM is easier but separates the UI from the canvas.
   - *Design Choice*: The adapter should remain visually agnostic. It should capture the coordinates and expose the mathematical state, allowing the consumer to render it in the DOM (via CSS absolute positioning) or on the Canvas (via `ctx.arc`).
3. **Should we support keyboard emulation?**
   - *Context*: Some engines map virtual joystick movements to fake KeyboardEvents so the game's core input loop doesn't have to change.
   - *Design Choice*: No. Keyboard emulation is computationally wasteful and fragile. Composing the polled edges via `orEdges` is much cleaner, safer, and highly performant.

---

## Top 3 Patterns Worth Prototyping

1. **Composite Virtual D-Pad (Discrete DOM)**
   - *Why*: The simplest and most accessible pattern. It wraps 4 DOM elements into a single adapter that returns 4 directional `PolledEdge` snapshots, resolving multi-touch pointer IDs correctly and composing directly with `orEdges`.
2. **Analog Thumbstick Adapter with Thresholded Output**
   - *Why*: The gold standard for mobile ergonomics. It tracks a single pointer, computes a normalized 2D vector, applies a dead-zone, and thresholds the vector into binary "left", "right", "up", "down" edges for the platformer simulation.
3. **Canvas Pointer-Region Hit-Tester**
   - *Why*: A zero-DOM alternative that attaches directly to the canvas element. It performs manual coordinate hit-testing against viewport fractions, making it extremely lightweight and perfect for ultra-minimalist or JS13k-style games.

---

## Cross-References

- **Related notes in `docs/research/`**:
  - `docs/research/platformer-juice.md` (for mobile-friendly game-feel and responsiveness guidelines).
- **Related strategic docs in `ai-craft-strategy/`**:
  - `ai-craft-strategy/knowledge/sokpop-minimalist-rendering-teardown.md` (for minimalist rendering and mobile-web portal constraints).
- **Existing modules in `src/`**:
  - `src/input/edges.ts` (the deterministic edge core).
  - `src/input/touch-button.ts` (the existing single-button touch adapter).
  - `src/input/merge.ts` (the `orEdges` combinator).
