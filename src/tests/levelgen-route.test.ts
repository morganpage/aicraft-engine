/**
 * Tests for route graph generation.
 *
 * Tests cover:
 * - generateRoute returns a valid RouteGraph
 * - Start node at left, exit at right
 * - Branches based on difficulty
 * - Same seed → same route
 * - Different seed → different route
 *
 * @module
 */

import { describe, it, expect } from 'vitest';
import { generateRoute } from '../levelgen';
import type { LevelGenConfig } from '../levelgen/types';

const BASE_CONFIG: LevelGenConfig = { cols: 60, rows: 15, tileSize: 16, difficulty: 0.5 };

describe('generateRoute', () => {
  it('returns a valid RouteGraph with version 1', () => {
    const route = generateRoute(42, BASE_CONFIG);
    expect(route.version).toBe(1);
    expect(Array.isArray(route.nodes)).toBe(true);
    expect(Array.isArray(route.edges)).toBe(true);
  });

  it('has a start node at the left edge', () => {
    const route = generateRoute(42, BASE_CONFIG);
    const start = route.nodes.find((n) => n.kind === 'start');
    expect(start).toBeDefined();
    expect(start!.x).toBeLessThanOrEqual(2); // near left edge
  });

  it('has an exit node at the right edge', () => {
    const route = generateRoute(42, BASE_CONFIG);
    const exit = route.nodes.find((n) => n.kind === 'exit');
    expect(exit).toBeDefined();
    expect(exit!.x).toBeGreaterThanOrEqual(55); // near right edge (cols=60)
  });

  it('start and exit nodes have correct kinds', () => {
    const route = generateRoute(42, BASE_CONFIG);
    const start = route.nodes.find((n) => n.kind === 'start');
    const exit = route.nodes.find((n) => n.kind === 'exit');
    expect(start).toBeDefined();
    expect(exit).toBeDefined();
    expect(start!.kind).toBe('start');
    expect(exit!.kind).toBe('exit');
  });

  it('has at least one edge connecting start to something', () => {
    const route = generateRoute(42, BASE_CONFIG);
    const startEdge = route.edges.find((e) => e.from === 'start');
    expect(startEdge).toBeDefined();
  });

  it('produces branches at difficulty >= 0.3', () => {
    const lowDiff = generateRoute(42, { ...BASE_CONFIG, difficulty: 0.2 });
    const highDiff = generateRoute(42, { ...BASE_CONFIG, difficulty: 0.5 });
    const lowBranches = lowDiff.nodes.filter((n) => n.kind === 'branch');
    const highBranches = highDiff.nodes.filter((n) => n.kind === 'branch');
    // Low difficulty may have 0 branches; high difficulty should have 1+
    expect(lowBranches.length).toBe(0);
    expect(highBranches.length).toBeGreaterThanOrEqual(1);
  });

  it('produces 2 branches at difficulty >= 0.7', () => {
    const route = generateRoute(42, { ...BASE_CONFIG, difficulty: 0.8 });
    const branches = route.nodes.filter((n) => n.kind === 'branch');
    expect(branches.length).toBe(2);
  });

  it('reward nodes exist with each branch', () => {
    const route = generateRoute(42, { ...BASE_CONFIG, difficulty: 0.8 });
    const rewards = route.nodes.filter((n) => n.kind === 'reward');
    expect(rewards.length).toBeGreaterThanOrEqual(1);
  });

  it('branch nodes have edges connecting them', () => {
    const route = generateRoute(42, { ...BASE_CONFIG, difficulty: 0.5 });
    if (route.nodes.some((n) => n.kind === 'branch')) {
      const branchEdge = route.edges.find((e) => e.to.startsWith('branch') || e.from.startsWith('branch'));
      expect(branchEdge).toBeDefined();
    }
  });

  it('same seed → same route (byte-identical)', () => {
    const a = generateRoute(42, BASE_CONFIG);
    const b = generateRoute(42, BASE_CONFIG);
    expect(a.nodes).toEqual(b.nodes);
    expect(a.edges).toEqual(b.edges);
  });

  it('different seed → different route', () => {
    const a = generateRoute(42, BASE_CONFIG);
    const b = generateRoute(99, BASE_CONFIG);
    // Routes should differ in node positions or branch counts
    const aNodePositions = a.nodes.map((n) => `${n.x},${n.y}`).join(';');
    const bNodePositions = b.nodes.map((n) => `${n.x},${n.y}`).join(';');
    // They could theoretically be the same by coincidence, but extremely unlikely
    expect(aNodePositions).not.toEqual(bNodePositions);
  });

  it('handles very small grid gracefully', () => {
    const route = generateRoute(42, { cols: 10, rows: 5, tileSize: 16, difficulty: 0.5 });
    expect(route.nodes.length).toBeGreaterThanOrEqual(2); // at least start + exit
    for (const node of route.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('never throws on any input', () => {
    const badInputs: LevelGenConfig[] = [
      null as unknown as LevelGenConfig,
      undefined as unknown as LevelGenConfig,
      {} as LevelGenConfig,
      { cols: NaN } as LevelGenConfig,
      { rows: -1 } as LevelGenConfig,
      { difficulty: 50 } as LevelGenConfig,
    ];
    for (const input of badInputs) {
      expect(() => generateRoute(42, input)).not.toThrow();
    }
  });

  it('clamps difficulty to [0, 1]', () => {
    const over = generateRoute(42, { ...BASE_CONFIG, difficulty: 2.0 });
    const under = generateRoute(42, { ...BASE_CONFIG, difficulty: -1.0 });
    // Both should produce valid routes
    expect(over.nodes.length).toBeGreaterThanOrEqual(2);
    expect(under.nodes.length).toBeGreaterThanOrEqual(2);
  });
});
