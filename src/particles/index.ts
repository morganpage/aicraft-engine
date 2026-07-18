export type { Particle } from './types';
export { DEFAULT_GRAVITY_SCALE, DEFAULT_DRAG_SCALE, DEFAULT_RATE_SCALE, DEFAULT_INNER_RADIUS } from './constants';
export { spawn, type SpawnOptions } from './spawn';
export { advance, type AdvanceOptions } from './advance';
export { cull } from './cull';
export { step } from './step';
export { sampleRegion, type SpawnRegion } from './regions';
export { sampleConeVelocity, type ConeConfig } from './cone';
export {
  advanceEmission,
  createEmitter,
  stepEmitters,
  type EmissionState,
  type EmissionRateConfig,
  type Emitter,
  type EmitterConfig,
  type StepEmittersOptions,
} from './emitter';
export { particleAge, particleSizeCurve, particleAlphaCurve } from './lifetime';
export {
  LAVA_FIRE_PARTICLES,
  LAVA_SMOKE_PARTICLES,
  LAVA_SURFACE_COLOR,
  LAVA_BODY_COLOR,
  WATER_BUBBLE_PARTICLES,
  WATER_SURFACE_COLOR,
  type ParticlePreset,
} from './presets';
