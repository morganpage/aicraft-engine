import { describe, it, expect } from 'vitest';
import { createEnemyBehaviorRegistry } from '../platformer/enemy/registry';
import type { EnemyBehaviorHandler } from '../platformer/enemy/types';

describe('createEnemyBehaviorRegistry', () => {
  it('returns a handler for built-in archetype "spinny"', () => {
    const registry = createEnemyBehaviorRegistry();
    expect(registry.get('spinny')).toBeDefined();
    expect(typeof registry.get('spinny')!.step).toBe('function');
  });

  it('returns a handler for built-in archetype "turret"', () => {
    const registry = createEnemyBehaviorRegistry();
    expect(registry.get('turret')).toBeDefined();
    expect(typeof registry.get('turret')!.step).toBe('function');
  });

  it('merges custom handlers on top of built-ins', () => {
    const custom: EnemyBehaviorHandler = {
      step: (_state, _ctx) => ({
        x: 0, y: 0, vx: 0, vy: 0, facing: 1, alive: true, data: {},
      }),
    };
    const registry = createEnemyBehaviorRegistry({ custom: custom });
    expect(registry.get('custom')).toBe(custom);
    // Built-ins still present
    expect(registry.get('spinny')).toBeDefined();
  });

  it('custom handlers override built-ins of the same name', () => {
    const mySpinny: EnemyBehaviorHandler = {
      step: (_state, _ctx) => ({
        x: 999, y: 999, vx: 0, vy: 0, facing: 1, alive: true, data: {},
      }),
    };
    const registry = createEnemyBehaviorRegistry({ spinny: mySpinny });
    expect(registry.get('spinny')).toBe(mySpinny);
  });

  it('returns undefined for unknown archetype', () => {
    const registry = createEnemyBehaviorRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
  });
});
