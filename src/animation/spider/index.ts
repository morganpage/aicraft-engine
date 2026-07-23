/**
 * Procedural spider locomotion module.
 *
 * Deterministic core: gait solver, ground sampling, state facade, and
 * three-segment leg geometry.
 * Renderer-adjacent: pose evaluation and body/leg drawing.
 *
 * @module
 */

export {
  type SpiderGaitMode,
  type LegRestPosition,
  type GaitLegState,
  type GaitState,
  type SpiderGaitConfig,
  createGaitState,
  advanceGait,
  getGaitFootPosition,
  sampleStepArc,
} from './gait';

export {
  type GroundSampleResult,
  sampleGround,
} from './ground-sample';

export {
  type SpiderPalette,
  type SpiderVisualConfig,
  type EyeDefinition,
  type CheliceraDefinition,
  type SpiderState,
  createSpiderState,
  stepSpider,
} from './spider-state';

export {
  type SpiderConfig,
  type SpiderLegGeometryConfig,
  splitSpiderConfig,
} from './types';

export {
  DEFAULT_SPIDER,
  DEFAULT_SPIDER_PALETTE,
  DEFAULT_SPIDER_GEOMETRY,
} from './constants';

export {
  type LegPose,
  type SpiderPose,
  evaluateSpiderPose,
  drawSpider,
} from './spider';

export {
  type FemurTibiaAnnuli,
  type LegStepRequest,
  computeHipPosition,
  computeCoxaEndpoint,
  computeFemurTibiaAnnuli,
  projectTargetIntoWorkspace,
  projectGroundedTargetIntoWorkspace,
  solveThreeSegmentLeg,
  computeLegStepRequest,
} from './geometry';
