import { evaluateLocomotion } from '../../../src/animation/locomotion';
import { solveLimb } from '../../../src/animation/ik/limb';
import { breathe } from '../../../src/animation/squash-stretch';
import type { Vec2 } from '../../../src/animation/types';
import {
  HUMANOID_BASE_HEIGHT,
  HUMANOID_BASE_WIDTH,
  HUMANOID_EYE_RADIUS,
  HUMANOID_IDLE_ARM_EXTENSION,
  HUMANOID_IDLE_HAND_OUTSET,
  HUMANOID_IDLE_HIP_Y,
  HUMANOID_IDLE_STANCE_WIDTH,
  HUMANOID_OUTLINE_WIDTH,
  HUMANOID_TARGET_ARM_BLEND,
} from './constants';
import type {
  CharacterBodyFrame,
  CharacterDrawOptions,
} from './body-plan-types';
import type { HumanoidConfig } from './humanoid-config';
import type { HumanoidVisualState } from './humanoid-state';

export interface HumanoidLegPose {
  readonly hip: Readonly<Vec2>;
  readonly knee: Readonly<Vec2>;
  readonly foot: Readonly<Vec2>;
}

export interface HumanoidLowerBodyPose {
  readonly torsoTop: number;
  readonly torsoBottom: number;
  readonly leftLeg: HumanoidLegPose;
  readonly rightLeg: HumanoidLegPose;
}

export interface HumanoidArmPose {
  readonly shoulder: Readonly<Vec2>;
  readonly elbow: Readonly<Vec2>;
  readonly hand: Readonly<Vec2>;
}

export interface HumanoidUpperBodyPose {
  readonly leftArm: HumanoidArmPose;
  readonly rightArm: HumanoidArmPose;
}

function drawBone(
  ctx: CanvasRenderingContext2D,
  from: Readonly<Vec2>,
  via: Readonly<Vec2>,
  to: Readonly<Vec2>,
  color: string,
  width: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(via.x, via.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function poseYOffset(state: HumanoidVisualState): number {
  if (state.airPose === 'ascent') return -1.4;
  if (state.airPose === 'descent') return 0.8;
  if (state.airPose === 'apex') return -0.4;
  return state.landingBlend * 1.2 - state.launchBlend * 0.8;
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

export function evaluateHumanoidLowerBodyPose(
  config: HumanoidConfig,
  state: HumanoidVisualState,
): HumanoidLowerBodyPose {
  const gait = evaluateLocomotion(state.locomotion, config.gait);
  const activeBlend = 1 - state.idleBlend;
  const hipOffset = {
    x: gait.hipOffset.x * activeBlend,
    y: gait.hipOffset.y * activeBlend,
  };
  const torsoBottom = mix(
    -9 + gait.hipOffset.y,
    HUMANOID_IDLE_HIP_Y,
    state.idleBlend,
  );
  const torsoTop = torsoBottom - config.torsoHeight;
  const hipLeft = { x: -2 + hipOffset.x, y: torsoBottom };
  const hipRight = { x: 2 + hipOffset.x, y: torsoBottom };
  const airTuck = state.airPose === 'grounded' ? 0 : 2.3;
  const movingLeftFoot = {
    x: -2 + gait.leftFootOffset.x,
    y: -gait.leftFootOffset.y - airTuck,
  };
  const movingRightFoot = {
    x: 2 + gait.rightFootOffset.x,
    y: -gait.rightFootOffset.y - airTuck,
  };
  const leftFoot = {
    x: mix(movingLeftFoot.x, -HUMANOID_IDLE_STANCE_WIDTH / 2, state.idleBlend),
    y: mix(movingLeftFoot.y, 0, state.idleBlend),
  };
  const rightFoot = {
    x: mix(movingRightFoot.x, HUMANOID_IDLE_STANCE_WIDTH / 2, state.idleBlend),
    y: mix(movingRightFoot.y, 0, state.idleBlend),
  };
  const leftLeg = solveLimb(
    hipLeft,
    leftFoot,
    config.thighLength,
    config.shinLength,
    { bendDir: 1 },
  );
  const rightLeg = solveLimb(
    hipRight,
    rightFoot,
    config.thighLength,
    config.shinLength,
    { bendDir: -1 },
  );

  return {
    torsoTop,
    torsoBottom,
    leftLeg: {
      hip: hipLeft,
      knee: leftLeg.jointPos,
      foot: leftLeg.endPos,
    },
    rightLeg: {
      hip: hipRight,
      knee: rightLeg.jointPos,
      foot: rightLeg.endPos,
    },
  };
}

export function evaluateHumanoidUpperBodyPose(
  config: HumanoidConfig,
  state: HumanoidVisualState,
  torsoTop: number,
  rightHandTarget: Readonly<Vec2> | null = null,
): HumanoidUpperBodyPose {
  const shoulderY = torsoTop + 2.2;
  const shoulderHalf = config.shoulderWidth / 2;
  const swing =
    Math.sin(state.locomotion.phase) * 3.2 * (1 - state.idleBlend);
  const relaxedDrop =
    (config.upperArmLength + config.lowerArmLength) *
    HUMANOID_IDLE_ARM_EXTENSION;
  const leftShoulder = { x: -shoulderHalf, y: shoulderY };
  const rightShoulder = { x: shoulderHalf, y: shoulderY };
  const leftHand = {
    x: -shoulderHalf - HUMANOID_IDLE_HAND_OUTSET - swing,
    y: shoulderY + relaxedDrop,
  };
  const passiveRightHand = {
    x: shoulderHalf + HUMANOID_IDLE_HAND_OUTSET + swing,
    y: shoulderY + relaxedDrop,
  };
  const rightHand = rightHandTarget
    ? {
        x: mix(
          passiveRightHand.x,
          rightHandTarget.x,
          HUMANOID_TARGET_ARM_BLEND,
        ),
        y: mix(
          passiveRightHand.y,
          rightHandTarget.y,
          HUMANOID_TARGET_ARM_BLEND,
        ),
      }
    : passiveRightHand;
  const leftArm = solveLimb(
    leftShoulder,
    leftHand,
    config.upperArmLength,
    config.lowerArmLength,
    { bendDir: 1 },
  );
  const rightArm = solveLimb(
    rightShoulder,
    rightHand,
    config.upperArmLength,
    config.lowerArmLength,
    { bendDir: -1 },
  );

  return {
    leftArm: {
      shoulder: leftShoulder,
      elbow: leftArm.jointPos,
      hand: leftArm.endPos,
    },
    rightArm: {
      shoulder: rightShoulder,
      elbow: rightArm.jointPos,
      hand: rightArm.endPos,
    },
  };
}

export function drawHumanoid(
  ctx: CanvasRenderingContext2D,
  body: CharacterBodyFrame,
  config: HumanoidConfig,
  state: HumanoidVisualState,
  tick: number,
  options?: CharacterDrawOptions,
): void {
  const scale = Math.max(
    0.05,
    Math.min(body.width / HUMANOID_BASE_WIDTH, body.height / HUMANOID_BASE_HEIGHT),
  );
  const breathScale = breathe(tick, config.breath);
  const palette = config.palette;
  const lowerBody = evaluateHumanoidLowerBodyPose(config, state);

  ctx.save();
  ctx.translate(body.x + body.width / 2, body.y + body.height);
  ctx.scale(body.facing * scale, scale);
  ctx.translate(0, poseYOffset(state));

  const { torsoBottom, torsoTop, leftLeg, rightLeg } = lowerBody;
  drawBone(ctx, rightLeg.hip, rightLeg.knee, rightLeg.foot, palette.outline, 3.4);
  drawBone(ctx, rightLeg.hip, rightLeg.knee, rightLeg.foot, palette.accent, 1.8);
  drawBone(ctx, leftLeg.hip, leftLeg.knee, leftLeg.foot, palette.outline, 3.4);
  drawBone(ctx, leftLeg.hip, leftLeg.knee, leftLeg.foot, palette.base, 1.8);

  const target = state.armTarget ?? options?.lookTarget;
  const localTarget = target
    ? {
        x:
          ((target.x - (body.x + body.width / 2)) / scale) *
          body.facing,
        y: (target.y - (body.y + body.height)) / scale,
      }
    : null;
  const upperBody = evaluateHumanoidUpperBodyPose(
    config,
    state,
    torsoTop,
    localTarget,
  );
  drawBone(
    ctx,
    upperBody.leftArm.shoulder,
    upperBody.leftArm.elbow,
    upperBody.leftArm.hand,
    palette.outline,
    3,
  );
  drawBone(
    ctx,
    upperBody.leftArm.shoulder,
    upperBody.leftArm.elbow,
    upperBody.leftArm.hand,
    palette.accent,
    1.5,
  );

  ctx.save();
  ctx.translate(0, (torsoTop + torsoBottom) / 2);
  ctx.scale(breathScale.scaleX, breathScale.scaleY);
  ctx.fillStyle = palette.base;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = HUMANOID_OUTLINE_WIDTH;
  ctx.beginPath();
  ctx.roundRect(
    -config.torsoWidth / 2,
    -config.torsoHeight / 2,
    config.torsoWidth,
    config.torsoHeight,
    1.5,
  );
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  drawBone(
    ctx,
    upperBody.rightArm.shoulder,
    upperBody.rightArm.elbow,
    upperBody.rightArm.hand,
    palette.outline,
    3,
  );
  drawBone(
    ctx,
    upperBody.rightArm.shoulder,
    upperBody.rightArm.elbow,
    upperBody.rightArm.hand,
    palette.feature,
    1.5,
  );

  const headY = torsoTop - config.headRadius + 0.4;
  ctx.fillStyle = palette.accent;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = HUMANOID_OUTLINE_WIDTH;
  ctx.beginPath();
  ctx.arc(0, headY, config.headRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (config.headStyle !== 'bare') {
    ctx.fillStyle = palette.feature;
    ctx.beginPath();
    if (config.headStyle === 'crest') {
      ctx.moveTo(-config.headRadius, headY - 1);
      ctx.lineTo(0, headY - config.headRadius - 2);
      ctx.lineTo(config.headRadius, headY - 1);
    } else {
      ctx.rect(
        -config.headRadius,
        headY - config.headRadius,
        config.headRadius * 2,
        config.headRadius,
      );
    }
    ctx.fill();
    ctx.stroke();
  }

  ctx.fillStyle = palette.feature;
  ctx.beginPath();
  ctx.arc(config.eyeOffsetX, headY - 0.3, HUMANOID_EYE_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
