import { evaluateLocomotion } from '../../../src/animation/locomotion';
import { solveLimb } from '../../../src/animation/ik/limb';
import { breathe } from '../../../src/animation/squash-stretch';
import type { Vec2 } from '../../../src/animation/types';
import {
  HUMANOID_BASE_HEIGHT,
  HUMANOID_BASE_WIDTH,
  HUMANOID_EYE_RADIUS,
  HUMANOID_OUTLINE_WIDTH,
  HUMANOID_TARGET_ARM_BLEND,
} from './constants';
import type {
  CharacterBodyFrame,
  CharacterDrawOptions,
} from './body-plan-types';
import type { HumanoidConfig } from './humanoid-config';
import type { HumanoidVisualState } from './humanoid-state';

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
  const gait = evaluateLocomotion(state.locomotion, config.gait);
  const breathScale = breathe(tick, config.breath);
  const palette = config.palette;

  ctx.save();
  ctx.translate(body.x + body.width / 2, body.y + body.height);
  ctx.scale(body.facing * scale, scale);
  ctx.translate(0, poseYOffset(state));

  const torsoBottom = -9 + gait.hipOffset.y;
  const torsoTop = torsoBottom - config.torsoHeight;
  const hipLeft = { x: -2 + gait.hipOffset.x, y: torsoBottom };
  const hipRight = { x: 2 + gait.hipOffset.x, y: torsoBottom };
  const footBaseY = 0;
  const airTuck = state.airPose === 'grounded' ? 0 : 2.3;
  const leftFoot = {
    x: -2 + gait.leftFootOffset.x,
    y: footBaseY - gait.leftFootOffset.y - airTuck,
  };
  const rightFoot = {
    x: 2 + gait.rightFootOffset.x,
    y: footBaseY - gait.rightFootOffset.y - airTuck,
  };
  const leftLeg = solveLimb(
    hipLeft,
    leftFoot,
    config.thighLength,
    config.shinLength,
    { bendDir: -1 },
  );
  const rightLeg = solveLimb(
    hipRight,
    rightFoot,
    config.thighLength,
    config.shinLength,
    { bendDir: 1 },
  );

  drawBone(ctx, hipRight, rightLeg.jointPos, rightLeg.endPos, palette.outline, 3.4);
  drawBone(ctx, hipRight, rightLeg.jointPos, rightLeg.endPos, palette.accent, 1.8);
  drawBone(ctx, hipLeft, leftLeg.jointPos, leftLeg.endPos, palette.outline, 3.4);
  drawBone(ctx, hipLeft, leftLeg.jointPos, leftLeg.endPos, palette.base, 1.8);

  const shoulderY = torsoTop + 2.2;
  const shoulderHalf = config.shoulderWidth / 2;
  const phase = state.locomotion.phase;
  const passiveSwing = Math.sin(phase) * 3.2;
  const leftShoulder = { x: -shoulderHalf, y: shoulderY };
  const rightShoulder = { x: shoulderHalf, y: shoulderY };
  const defaultLeftHand = { x: -shoulderHalf - passiveSwing, y: torsoBottom - 0.5 };
  const defaultRightHand = { x: shoulderHalf + passiveSwing, y: torsoBottom - 0.5 };
  const target = state.armTarget ?? options?.lookTarget;
  const localTarget = target
    ? {
        x:
          ((target.x - (body.x + body.width / 2)) / scale) *
          body.facing,
        y: (target.y - (body.y + body.height)) / scale,
      }
    : null;
  const rightHand = localTarget
    ? {
        x:
          defaultRightHand.x +
          (localTarget.x - defaultRightHand.x) * HUMANOID_TARGET_ARM_BLEND,
        y:
          defaultRightHand.y +
          (localTarget.y - defaultRightHand.y) * HUMANOID_TARGET_ARM_BLEND,
      }
    : defaultRightHand;
  const leftArm = solveLimb(
    leftShoulder,
    defaultLeftHand,
    config.upperArmLength,
    config.lowerArmLength,
    { bendDir: -1 },
  );
  const rightArm = solveLimb(
    rightShoulder,
    rightHand,
    config.upperArmLength,
    config.lowerArmLength,
    { bendDir: 1 },
  );

  drawBone(ctx, leftShoulder, leftArm.jointPos, leftArm.endPos, palette.outline, 3);
  drawBone(ctx, leftShoulder, leftArm.jointPos, leftArm.endPos, palette.accent, 1.5);

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

  drawBone(ctx, rightShoulder, rightArm.jointPos, rightArm.endPos, palette.outline, 3);
  drawBone(ctx, rightShoulder, rightArm.jointPos, rightArm.endPos, palette.feature, 1.5);

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
