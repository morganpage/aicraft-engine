import type { Vec2 } from '../../../src/animation/types';

export interface CharacterBodyFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly facing: 1 | -1;
}

export interface CharacterDrawOptions {
  readonly lookTarget?: Readonly<Vec2>;
}

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

export type AnyBodyPlanHandler = BodyPlanHandler<any, any, any>;

export type BodyPlanHandlerMap = Readonly<Record<string, AnyBodyPlanHandler>>;

export interface UnknownBodyPlanHandler {
  deriveConfig(seed: number): unknown;
  createVisualState(config: never): unknown;
  advanceVisual(
    config: never,
    state: never,
    motion: never,
    dt: number,
  ): unknown;
  draw(
    ctx: CanvasRenderingContext2D,
    body: CharacterBodyFrame,
    config: never,
    state: never,
    tick: number,
    options?: CharacterDrawOptions,
  ): void;
}

export interface BodyPlanRegistry<THandlers extends BodyPlanHandlerMap> {
  get<TKey extends keyof THandlers>(plan: TKey): THandlers[TKey];
  get(plan: string): UnknownBodyPlanHandler | undefined;
}
