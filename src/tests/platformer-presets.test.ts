import { describe, it, expect } from 'vitest';
import {
  PRECISION_PLATFORMER,
  CLASSIC_PLATFORMER,
  EXPLORATION_PLATFORMER,
  PUZZLE_PLATFORMER,
} from '../platformer/presets';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';
import type { PlatformerConfig } from '../platformer/types';

/**
 * Sanity checks for the named PlatformerConfig presets. These tests pin the
 * documented "feel" of each preset (Celeste-like, Mario-like, etc.) via a
 * few canonical toggles so that a future tuning pass doesn't silently
 * change the contract.
 */

function isPlatformerConfig(c: unknown): c is PlatformerConfig {
  if (typeof c !== 'object' || c === null) return false;
  const r = c as Record<string, unknown>;
  return (
    typeof r.gravity === 'number' &&
    typeof r.maxFallSpeed === 'number' &&
    typeof r.moveSpeed === 'number' &&
    typeof r.airControl === 'number' &&
    typeof r.wallSlideEnabled === 'boolean' &&
    typeof r.dashEnabled === 'boolean' &&
    typeof r.doubleJumpEnabled === 'boolean'
  );
}

describe('presets', () => {
  it('PRECISION_PLATFORMER is a valid PlatformerConfig', () => {
    expect(isPlatformerConfig(PRECISION_PLATFORMER)).toBe(true);
  });

  it('PRECISION_PLATFORMER matches DEFAULT_PLATFORMER_CONFIG (Celeste-like default feel)', () => {
    expect(PRECISION_PLATFORMER).toEqual(DEFAULT_PLATFORMER_CONFIG);
  });

  it('PRECISION_PLATFORMER has dash enabled (Celeste-like)', () => {
    expect(PRECISION_PLATFORMER.dashEnabled).toBe(true);
  });

  it('CLASSIC_PLATFORMER is a valid PlatformerConfig', () => {
    expect(isPlatformerConfig(CLASSIC_PLATFORMER)).toBe(true);
  });

  it('CLASSIC_PLATFORMER disables dash, wall-slide, and double-jump (Mario-like)', () => {
    expect(CLASSIC_PLATFORMER.dashEnabled).toBe(false);
    expect(CLASSIC_PLATFORMER.wallSlideEnabled).toBe(false);
    expect(CLASSIC_PLATFORMER.doubleJumpEnabled).toBe(false);
  });

  it('CLASSIC_PLATFORMER has higher gravity and faster run than the default', () => {
    expect(CLASSIC_PLATFORMER.gravity).toBeGreaterThan(DEFAULT_PLATFORMER_CONFIG.gravity);
    expect(CLASSIC_PLATFORMER.moveSpeed).toBeGreaterThan(DEFAULT_PLATFORMER_CONFIG.moveSpeed);
  });

  it('EXPLORATION_PLATFORMER is a valid PlatformerConfig', () => {
    expect(isPlatformerConfig(EXPLORATION_PLATFORMER)).toBe(true);
  });

  it('EXPLORATION_PLATFORMER enables wall-slide and disables dash + double-jump (Hollow Knight-like)', () => {
    expect(EXPLORATION_PLATFORMER.wallSlideEnabled).toBe(true);
    expect(EXPLORATION_PLATFORMER.dashEnabled).toBe(false);
    expect(EXPLORATION_PLATFORMER.doubleJumpEnabled).toBe(false);
  });

  it('EXPLORATION_PLATFORMER has lower gravity and more generous air control than the default', () => {
    expect(EXPLORATION_PLATFORMER.gravity).toBeLessThan(DEFAULT_PLATFORMER_CONFIG.gravity);
    expect(EXPLORATION_PLATFORMER.airControl).toBeGreaterThan(DEFAULT_PLATFORMER_CONFIG.airControl);
  });

  it('PUZZLE_PLATFORMER is a valid PlatformerConfig', () => {
    expect(isPlatformerConfig(PUZZLE_PLATFORMER)).toBe(true);
  });

  it('PUZZLE_PLATFORMER disables every ability (tight grid movement, no fancy movement)', () => {
    expect(PUZZLE_PLATFORMER.dashEnabled).toBe(false);
    expect(PUZZLE_PLATFORMER.wallSlideEnabled).toBe(false);
    expect(PUZZLE_PLATFORMER.doubleJumpEnabled).toBe(false);
  });

  it('PUZZLE_PLATFORMER has a slower (tight) move speed than the default', () => {
    expect(PUZZLE_PLATFORMER.moveSpeed).toBeLessThan(DEFAULT_PLATFORMER_CONFIG.moveSpeed);
  });
});
