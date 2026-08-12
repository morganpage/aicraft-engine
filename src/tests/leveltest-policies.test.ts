/**
 * Tests for bot policies.
 *
 * @module
 */

import { describe, it, expect } from 'vitest';
import {
  cautiousPolicy,
  directPolicy,
  collectorPolicy,
  DEFAULT_BOT_POLICIES,
} from '../leveltest/policies';
import type { BotPolicy, BotContext } from '../leveltest/policies';
import type { PlatformerState } from '../platformer/types';
import type { LevelEntity } from '../level/types';
import type { Solid } from '../collision/types';
import { EMPTY_CONTACTS, EMPTY_EVENTS, EMPTY_INTERACTIONS, DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { createJumpState } from '../animation/jump';
import { EMPTY_LOCOMOTION } from '../platformer/constants';

function makeState(x: number, y: number, onGround: boolean = true): PlatformerState {
  return {
    core: {
      x,
      y,
      width: 16,
      height: 24,
      vx: 0,
      vy: 0,
      facing: 1,
      onGround,
      contacts: EMPTY_CONTACTS,
    },
    abilities: {
      jump: { kind: 'jump' as const, jump: createJumpState(DEFAULT_PLATFORMER_CONFIG.jump) },
      dash: { kind: 'dash' as const, phase: 'idle', startupTimer: 0, timer: 0, cooldown: 0, dashesRemaining: 1, dirX: 0, dirY: 0, beforeDashVx: 0, dashStartedOnGround: false, hyperSlide: false },
    },
    locomotion: EMPTY_LOCOMOTION,
    events: EMPTY_EVENTS,
    interactions: EMPTY_INTERACTIONS,
    tick: 0,
  };
}

function makeDefaultContext(overrides?: Partial<BotContext>): BotContext {
  return {
    entities: [],
    solids: [],
    movingPlatforms: [],
    tick: 0,
    dt: 1 / 60,
    jumpConfig: DEFAULT_PLATFORMER_CONFIG.jump,
    save: { collected: [] },
    ...overrides,
  };
}

function makeExitEntity(id: number, x: number, y: number): LevelEntity {
  return {
    id,
    kind: 'exit' as const,
    rect: { x, y, width: 32, height: 48 },
    props: { isTrap: false, locked: false },
  };
}

function makeCollectibleEntity(id: number, x: number, y: number): LevelEntity {
  return {
    id,
    kind: 'collectible' as const,
    rect: { x, y, width: 16, height: 16 },
    props: { kind: 'coin' as const },
  };
}

function makeGroundSolid(x: number, y: number, width: number = 200): Solid {
  return {
    id: `ground-${x}`,
    x,
    y,
    width,
    height: 16,
  };
}

describe('cautiousPolicy', () => {
  it('returns a valid PlatformerInput', () => {
    const state = makeState(50, 500);
    const ctx = makeDefaultContext({
      entities: [makeExitEntity(1, 200, 476)],
      solids: [makeGroundSolid(0, 524)],
    });
    const input = cautiousPolicy(state, ctx);
    expect(input).toBeDefined();
    expect([-1, 0, 1]).toContain(input.moveX);
    expect(typeof input.jump).toBe('object');
    expect(typeof input.dash).toBe('object');
  });

  it('moves toward the nearest exit', () => {
    const state = makeState(50, 500);
    const ctx = makeDefaultContext({
      entities: [makeExitEntity(1, 200, 476)],
      solids: [makeGroundSolid(0, 524)],
    });
    const input = cautiousPolicy(state, ctx);
    // Exit is to the right → move right
    expect(input.moveX).toBe(1);
  });

  it('returns idle when no exit exists', () => {
    const state = makeState(50, 500);
    const ctx = makeDefaultContext({
      solids: [makeGroundSolid(0, 524)],
    });
    const input = cautiousPolicy(state, ctx);
    expect(input).toBeDefined();
    expect(input.moveX).toBe(0);
  });
});

describe('directPolicy', () => {
  it('returns a valid PlatformerInput', () => {
    const state = makeState(50, 500);
    const ctx = makeDefaultContext({
      entities: [makeExitEntity(1, 200, 476)],
      solids: [makeGroundSolid(0, 524)],
    });
    const input = directPolicy(state, ctx);
    expect(input).toBeDefined();
    expect([-1, 0, 1]).toContain(input.moveX);
    expect(typeof input.jump).toBe('object');
    expect(typeof input.dash).toBe('object');
  });

  it('moves toward the nearest exit', () => {
    const state = makeState(50, 500);
    const ctx = makeDefaultContext({
      entities: [makeExitEntity(1, 200, 476)],
      solids: [makeGroundSolid(0, 524)],
    });
    const input = directPolicy(state, ctx);
    expect(input.moveX).toBe(1);
  });

  it('returns idle when no exit exists', () => {
    const state = makeState(50, 500);
    const ctx = makeDefaultContext({
      solids: [makeGroundSolid(0, 524)],
    });
    const input = directPolicy(state, ctx);
    expect(input.moveX).toBe(0);
  });
});

describe('collectorPolicy', () => {
  it('returns a valid PlatformerInput', () => {
    const state = makeState(50, 500);
    const ctx = makeDefaultContext({
      entities: [
        makeExitEntity(1, 200, 476),
        makeCollectibleEntity(2, 100, 500),
      ],
      solids: [makeGroundSolid(0, 524)],
      save: { collected: [] },
    });
    const input = collectorPolicy(state, ctx);
    expect(input).toBeDefined();
    expect([-1, 0, 1]).toContain(input.moveX);
    expect(typeof input.jump).toBe('object');
    expect(typeof input.dash).toBe('object');
  });

  it('heads toward uncollected collectibles', () => {
    const state = makeState(50, 500);
    const ctx = makeDefaultContext({
      entities: [
        makeExitEntity(1, 300, 476),
        makeCollectibleEntity(2, 100, 500), // Closer than exit
      ],
      solids: [makeGroundSolid(0, 524)],
      save: { collected: [] },
    });
    const input = collectorPolicy(state, ctx);
    // Collectible is to the right → move right
    expect(input.moveX).toBe(1);
  });

  it('falls back to directPolicy when all collectibles are collected', () => {
    const state = makeState(50, 500);
    const ctx = makeDefaultContext({
      entities: [
        makeExitEntity(1, 300, 476),
        makeCollectibleEntity(2, 100, 500),
      ],
      solids: [makeGroundSolid(0, 524)],
      save: { collected: ['2'] }, // Already collected
    });
    const input = collectorPolicy(state, ctx);
    // Should move toward exit (right)
    expect(input.moveX).toBe(1);
  });
});

describe('DEFAULT_BOT_POLICIES', () => {
  it('includes all three policies', () => {
    expect(DEFAULT_BOT_POLICIES.length).toBe(3);
    expect(DEFAULT_BOT_POLICIES).toContain(cautiousPolicy);
    expect(DEFAULT_BOT_POLICIES).toContain(directPolicy);
    expect(DEFAULT_BOT_POLICIES).toContain(collectorPolicy);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(DEFAULT_BOT_POLICIES)).toBe(true);
  });
});

describe('policies never throw', () => {
  const policies: BotPolicy[] = [cautiousPolicy, directPolicy, collectorPolicy];

  for (const policy of policies) {
    it(`${policy.name || 'policy'} never throws on bad state`, () => {
      const badState = null as unknown as PlatformerState;
      const ctx = makeDefaultContext();
      expect(() => policy(badState, ctx)).not.toThrow();
    });

    it(`${policy.name || 'policy'} never throws on bad context`, () => {
      const state = makeState(0, 0);
      const badCtx = null as unknown as BotContext;
      expect(() => policy(state, badCtx)).not.toThrow();
    });
  }
});
