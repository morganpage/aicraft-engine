import { generatePalette } from '../../palette/generate';
import { mulberry32, nextFloat, nextInt } from '../../rng/mulberry32';
import {
  DEFAULT_HUMANOID_SEED,
  HUMANOID_BREATH,
  HUMANOID_GAIT,
} from './constants';
import type { HumanoidConfig } from './types';

/**
 * Derive a deterministic humanoid config.
 *
 * RNG order is locked: torso width/height, head radius, shoulder width, upper
 * arm, lower arm, thigh, shin, head style, eye offset, stride length, stride
 * height. Palette generation uses its own seed-local stream.
 */
export function deriveHumanoidConfig(seed: number): HumanoidConfig {
  const normalizedSeed = Number.isFinite(seed) ? seed >>> 0 : 0;
  const rng = mulberry32(normalizedSeed);
  const torsoWidth = nextFloat(rng, 7.2, 9.2);
  const torsoHeight = nextFloat(rng, 7.4, 9.4);
  const headRadius = nextFloat(rng, 3.0, 3.8);
  const shoulderWidth = torsoWidth + nextFloat(rng, 1.2, 2.4);
  const upperArmLength = nextFloat(rng, 4.1, 5.0);
  const lowerArmLength = nextFloat(rng, 3.8, 4.8);
  const thighLength = nextFloat(rng, 5.0, 6.0);
  const shinLength = nextFloat(rng, 4.8, 5.8);
  const headStyle = (['bare', 'cap', 'crest'] as const)[nextInt(rng, 0, 2)];
  const eyeOffsetX = nextFloat(rng, 1.3, 2.0);
  return {
    seed: normalizedSeed,
    palette: generatePalette(normalizedSeed),
    torsoWidth,
    torsoHeight,
    headRadius,
    shoulderWidth,
    upperArmLength,
    lowerArmLength,
    thighLength,
    shinLength,
    headStyle,
    eyeOffsetX,
    gait: {
      ...HUMANOID_GAIT,
      strideLength: nextFloat(rng, 3.0, 3.9),
      strideHeight: nextFloat(rng, 2.4, 3.2),
    },
    breath: { ...HUMANOID_BREATH },
  };
}

/** Default humanoid configuration. */
export const DEFAULT_HUMANOID: Readonly<HumanoidConfig> =
  deriveHumanoidConfig(DEFAULT_HUMANOID_SEED);
