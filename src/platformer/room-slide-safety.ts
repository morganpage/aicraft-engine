/**
 * Collision-safe simulation helpers for room slides.
 *
 * A room slide may keep simulating the actor so momentum and abilities survive
 * the seam. When the source room's support surface ends before the presentation
 * slide does, a grounded actor must not be carried invisibly off that ledge.
 * These helpers are pure and intentionally separate from the camera slide
 * state: the game chooses whether to use them based on its slide policy.
 */

import type { Solid } from '../collision/types';
import type { PlatformerInput, PlatformerState } from './types';

/** Collision tolerance used for support-face matching and ledge protection. */
export const ROOM_SLIDE_SUPPORT_EPSILON = 1;

interface SupportSpan {
  readonly left: number;
  readonly right: number;
  readonly top: number;
}
function isSupportSolid(solid: Readonly<Solid>): boolean {
  return !solid.ladder && solid.spring === undefined && !solid.dashRefill;
}

function mergedSupportSpans(
  solids: readonly Readonly<Solid>[],
  feetY: number,
): readonly SupportSpan[] {
  const floors = solids
    .filter((solid) => isSupportSolid(solid) && Math.abs(solid.y - feetY) <= ROOM_SLIDE_SUPPORT_EPSILON)
    .sort((a, b) => a.x - b.x || a.width - b.width);

  const spans: SupportSpan[] = [];
  for (const floor of floors) {
    const previous = spans[spans.length - 1];
    const right = floor.x + floor.width;
    if (previous !== undefined && floor.x <= previous.right + ROOM_SLIDE_SUPPORT_EPSILON) {
      spans[spans.length - 1] = {
        left: previous.left,
        right: Math.max(previous.right, right),
        top: previous.top,
      };
    } else {
      spans.push({ left: floor.x, right, top: floor.y });
    }
  }
  return spans;
}

function overlapsSpan(
  body: Readonly<{ x: number; width: number }>,
  span: SupportSpan,
): boolean {
  return body.x < span.right && span.left < body.x + body.width;
}

function fullyInsideSpan(
  body: Readonly<{ x: number; width: number }>,
  span: SupportSpan,
): boolean {
  return body.x >= span.left - ROOM_SLIDE_SUPPORT_EPSILON
    && body.x + body.width <= span.right + ROOM_SLIDE_SUPPORT_EPSILON;
}

/**
 * Prevent an active room slide from carrying a grounded actor over the end of
 * its current support surface.
 *
 * The candidate state is assumed to have already been produced by
 * `stepPlatformer`; ability timers and events therefore remain advanced. Only
 * an unsupported grounded walk-off is corrected. Explicit jumps and any
 * upward movement, including spring/mantle launches, pass through untouched.
 */
export function protectGroundedRoomSlide(
  previous: Readonly<PlatformerState>,
  candidate: Readonly<PlatformerState>,
  input: Readonly<PlatformerInput>,
  solids: readonly Readonly<Solid>[],
  slideActive: boolean,
): PlatformerState {
  if (!slideActive || !previous.core.onGround || input.jump.pressed) return candidate;

  // Upward movement is an authored launch, not a walk-off.
  if (candidate.core.y < previous.core.y - ROOM_SLIDE_SUPPORT_EPSILON || candidate.core.vy < 0) {
    return candidate;
  }

  const previousFeet = previous.core.y + previous.core.height;
  const previousSpans = mergedSupportSpans(solids, previousFeet);
  const support = previousSpans.find((span) => overlapsSpan(previous.core, span));
  if (support === undefined || support.right - support.left < previous.core.width) return candidate;

  const candidateFeet = candidate.core.y + candidate.core.height;
  const remainsFullySupported = mergedSupportSpans(solids, candidateFeet)
    .some((span) => fullyInsideSpan(candidate.core, span));
  if (remainsFullySupported) return candidate;

  const maxX = support.right - previous.core.width;
  const x = Math.max(support.left, Math.min(maxX, candidate.core.x));
  return {
    ...candidate,
    core: {
      ...candidate.core,
      x,
      y: support.top - previous.core.height,
      vx: 0,
      vy: 0,
      onGround: true,
      contacts: previous.core.contacts,
    },
  };
}
