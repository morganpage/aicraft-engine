/**
 * Type definitions for the follow-camera module.
 *
 * The camera is a pure world-space position: it never mutates game state,
 * only describes where the viewport's top-left sits in world coordinates.
 * The renderer reads `Camera.x / y` and rounds to integer pixels only when
 * applying the world transform (the camera itself stays float between
 * updates so the lerp stays smooth and never stalls).
 *
 * @module
 */

/**
 * Camera world-space position (top-left of the viewport).
 *
 * Stored as floats between updates for a smooth, non-stalling lerp. The
 * renderer rounds to integer pixels only when applying the world transform.
 */
export interface Camera {
  x: number;
  y: number;
}

/**
 * The target the camera follows. Typically the player's collision box, but
 * any axis-aligned rectangle works — the camera centres on the target's
 * midpoint.
 */
export interface CameraTarget {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Level / world bounds. The camera clamps so the viewport never shows outside
 * the level. When a bound is smaller than the viewport on an axis, the level
 * is centred on that axis instead (the camera goes negative).
 */
export interface CameraBounds {
  width: number;
  height: number;
}

/**
 * Camera behaviour tuning. Every field is optional and falls back to
 * {@link DEFAULT_CAMERA}; consumers spread their own values over the defaults.
 */
export interface CameraConfig {
  /**
   * Lerp factor per update (0 = never moves, 1 = instant snap to target).
   * Default 0.1 — smooth follow without noticeable lag. Higher = snappier.
   */
  lerp?: number;
  /**
   * Snap-to-target threshold in pixels. When the camera is within this
   * distance of its target on an axis, it snaps exactly. Prevents the lerp
   * from asymptoting forever at the clamp bounds (where per-tick increments
   * drop below the pixel grid and stall). Default 0.5.
   */
  snapThreshold?: number;
}

// --- Camera brain (light Cinemachine-style system) ------------------------
//
// Virtual cameras are plain, serializable config objects; the brain is a
// stateful-but-pure selector/blender that advances an independent live
// body/lens and composites a rendered view. See `brain.ts` for the lifecycle
// and per-step update order, and `docs/design/camera-brain-plan.md` for the
// full contract.

/** Screen-space viewport dimensions before camera zoom is applied. */
export interface CameraViewport {
  readonly width: number;
  readonly height: number;
}

/** Per-axis deadzone band as fractions of the visible dimension. */
export interface FollowBand {
  /** Rear fraction of the visible dimension; camera holds below this. */
  readonly trail: number;
  /** Forward fraction; the camera advances once the target passes this. */
  readonly lead: number;
}

/** Analytic scalar convergence tuning. Units depend on the value being moved. */
export interface DampedMotionConfig {
  /** Time in seconds to halve the remaining distance in the uncapped region. */
  readonly halfLife?: number;
  /** Maximum value-units per second (px/s for position, zoom-units/s for lens). */
  readonly maxSpeed?: number;
  /** Remaining distance at which to return the target exactly. */
  readonly snapThreshold?: number;
}

/** Tuning for the deadzone follow body. */
export interface FollowBodyConfig {
  /** Key into the brain's target table. Defaults to `DEFAULT_FOLLOW_BODY.targetKey` (`player`). */
  readonly targetKey?: string;
  /** Default `{ trail: 0.25, lead: 0.5 }`. */
  readonly followX?: Readonly<FollowBand>;
  /** Default `{ trail: 0.35, lead: 0.65 }`. */
  readonly followY?: Readonly<FollowBand>;
  readonly motion?: Readonly<DampedMotionConfig>;
  /** Non-negative world-unit overscan on every edge. Default 0. */
  readonly padding?: number;
}

export interface FixedBodyConfig {
  /** Desired viewport top-left in the current world coordinate space. */
  readonly x: number;
  readonly y: number;
  readonly motion?: Readonly<DampedMotionConfig>;
  /** Non-negative world-unit overscan on every edge. Default 0. */
  readonly padding?: number;
}

export type CameraBody =
  | ({ readonly mode: 'follow' } & FollowBodyConfig)
  | ({ readonly mode: 'fixed' } & FixedBodyConfig);

export interface CameraLens {
  /** Strictly-positive zoom target. */
  readonly zoom: number;
  readonly motion?: Readonly<DampedMotionConfig>;
}

/** A plain, serializable virtual-camera definition. */
export interface VirtualCamera {
  readonly id: string;
  /** Higher wins. Non-finite or absent values normalize to 0. */
  readonly priority?: number;
  /** Incoming brain-blend duration in seconds. Default 0.3; <= 0 disables it. */
  readonly blend?: number;
  /** Absent means hold the current live view centre, subject to lens/bounds. */
  readonly body?: CameraBody;
  /** Absent means keep the current live zoom. */
  readonly lens?: Readonly<CameraLens>;
}

/**
 * Running brain state. All fields are plain JSON-compatible data; the brain is
 * advanced immutably (`updateCameraBrain` returns a fresh object).
 *
 * The split between rendered state (`camera`/`zoom`) and live destination
 * state (`bodyCamera`/`lensZoom`) is essential: during a blend the live solver
 * advances independently and the rendered output is a composite, so a slow
 * blend can never feed back into the solver and cause double easing.
 */
export interface CameraBrain {
  /** Rendered/composited viewport top-left. */
  readonly camera: Readonly<Camera>;
  /** Rendered/composited zoom. */
  readonly zoom: number;
  /** Selected vcam; changes immediately when selection changes. */
  readonly activeId: string | null;
  /** Independent solver state of the selected vcam's body. */
  readonly bodyCamera: Readonly<Camera>;
  /** Independent solver state of the selected vcam's lens. */
  readonly lensZoom: number;
  readonly blend: null | {
    readonly fromId: string;
    readonly toId: string;
    readonly elapsed: number;
    readonly duration: number;
    /** Frozen world-space centre of the rendered source view. */
    readonly fromCenter: Readonly<{ x: number; y: number }>;
    readonly fromZoom: number;
    /** Frozen clamp padding of the source view (its body's padding). */
    readonly fromPadding: number;
  };
}

export interface CameraBrainOptions {
  readonly vcams:
    | Readonly<Record<string, VirtualCamera>>
    | readonly VirtualCamera[];
  readonly targets: Readonly<Record<string, CameraTarget>>;
  readonly bounds: CameraBounds;
  /** Physical screen pixels, never pre-divided by zoom. */
  readonly viewport: CameraViewport;
  /** Valid override wins; an unknown id falls back to automatic selection. */
  readonly activeId?: string;
  /** Frame delta in seconds. Non-finite or non-positive values advance by 0. */
  readonly dt: number;
}
