import type { Vec2 } from '../animation/types';

/** Consumer-owned world frame used to place a procedural character. */
export interface CharacterBodyFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly facing: 1 | -1;
}

/** Optional renderer-only character inputs. */
export interface CharacterDrawOptions {
  /** Optional eye/arm target in world space. */
  readonly lookTarget?: Readonly<Vec2>;
}

/** Typed contract implemented by a procedural body plan. */
export interface BodyPlanHandler<TConfig, TState, TMotion> {
  deriveConfig(seed: number): TConfig;
  createVisualState(config: TConfig): TState;
  advanceVisual(
    config: TConfig,
    state: TState,
    motion: TMotion,
    dt: number,
  ): TState;
  draw(
    ctx: CanvasRenderingContext2D,
    body: CharacterBodyFrame,
    config: TConfig,
    state: TState,
    tick: number,
    options?: CharacterDrawOptions,
  ): void;
}

/** Safely erased handler returned for a non-literal registry lookup. */
export interface UnknownBodyPlanHandler {
  deriveConfig(seed: number): unknown;
  createVisualState(config: never): unknown;
  advanceVisual(config: never, state: never, motion: never, dt: number): unknown;
  draw(
    ctx: CanvasRenderingContext2D,
    body: CharacterBodyFrame,
    config: never,
    state: never,
    tick: number,
    options?: CharacterDrawOptions,
  ): void;
}

/** Registry retaining the concrete handler type of known plan keys. */
export interface BodyPlanRegistry<THandlers extends Readonly<Record<string, BodyPlanHandler<any, any, any>>>> {
  get<TKey extends keyof THandlers>(plan: TKey): THandlers[TKey];
  get(plan: string): UnknownBodyPlanHandler | undefined;
}
