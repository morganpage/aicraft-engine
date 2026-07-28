/**
 * Tests for simulationTraceHash and playback determinism.
 */
import { describe, it, expect } from 'vitest';
import {
  simulationTraceHash,
  verifyScenario,
} from '../simtest';
import type {
  SimulationAdapter,
  SimulationPolicy,
  SimulationTrace,
} from '../simtest';

// ---------------------------------------------------------------------------
// Minimal counter adapter (shared)
// ---------------------------------------------------------------------------

interface CounterAction {
  readonly delta: number;
}

type CounterState = number;

const COUNTER_ADAPTER: SimulationAdapter<CounterState, CounterAction> = {
  id: 'counter-test',
  version: 1,
  scenarioFingerprint: 'counter-fp-v1',
  createInitialState: (_seed: number) => 0,
  actions: () => [{ delta: 1 }, { delta: 5 }, { delta: -1 }],
  step: (state, action) => state + action.delta,
  outcome: (state) => (state >= 100 ? 'success' : state < 0 ? 'failure' : 'running'),
};

const FAST_POLICY: SimulationPolicy<CounterState, CounterAction> = () => ({ delta: 5 });

// ---------------------------------------------------------------------------
// simulationTraceHash
// ---------------------------------------------------------------------------
describe('simulationTraceHash', () => {
  it('is deterministic: same trace → same hash', () => {
    const trace1: SimulationTrace<CounterAction> = {
      version: 1,
      adapterId: 'counter-test',
      adapterVersion: 1,
      scenarioFingerprint: 'counter-fp-v1',
      seed: 42,
      fixedDt: 1 / 60,
      actions: [{ delta: 5 }, { delta: 5 }, { delta: 5 }],
    };
    const trace2: SimulationTrace<CounterAction> = {
      version: 1,
      adapterId: 'counter-test',
      adapterVersion: 1,
      scenarioFingerprint: 'counter-fp-v1',
      seed: 42,
      fixedDt: 1 / 60,
      actions: [{ delta: 5 }, { delta: 5 }, { delta: 5 }],
    };
    expect(simulationTraceHash(trace1)).toBe(simulationTraceHash(trace2));
  });

  it('same adapter/scenario/seed/policy → byte-identical trace from verifyScenario', () => {
    const r1 = verifyScenario(COUNTER_ADAPTER, {
      maxTicks: 100,
      seed: 42,
      policies: [FAST_POLICY],
    });
    const r2 = verifyScenario(COUNTER_ADAPTER, {
      maxTicks: 100,
      seed: 42,
      policies: [FAST_POLICY],
    });

    expect(r1.winningTraceHash).toBe(r2.winningTraceHash);
    expect(simulationTraceHash(r1.winningTrace!)).toBe(simulationTraceHash(r2.winningTrace!));
  });

  it('different seed produces different hash', () => {
    const r1 = verifyScenario(COUNTER_ADAPTER, {
      maxTicks: 100,
      seed: 1,
      policies: [FAST_POLICY],
    });
    const r2 = verifyScenario(COUNTER_ADAPTER, {
      maxTicks: 100,
      seed: 2,
      policies: [FAST_POLICY],
    });
    // Different seed won't change the counter since createInitialState ignores seed for counter,
    // but the trace seed field IS different, so hashes SHOULD differ.
    expect(simulationTraceHash(r1.winningTrace!)).not.toBe(simulationTraceHash(r2.winningTrace!));
  });

  it('hash is a 32-bit unsigned integer (0 to 2^32-1)', () => {
    const trace: SimulationTrace<CounterAction> = {
      version: 1,
      adapterId: 'counter-test',
      adapterVersion: 1,
      scenarioFingerprint: 'counter-fp-v1',
      seed: 0,
      fixedDt: 1 / 60,
      actions: [],
    };
    const hash = simulationTraceHash(trace);
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(hash)).toBe(true);
  });

  it('null/undefined input returns 0', () => {
    expect(simulationTraceHash(null as unknown as SimulationTrace<CounterAction>)).toBe(0);
    expect(simulationTraceHash(undefined as unknown as SimulationTrace<CounterAction>)).toBe(0);
  });

  it('non-object input returns 0', () => {
    expect(simulationTraceHash('bad' as unknown as SimulationTrace<CounterAction>)).toBe(0);
    expect(simulationTraceHash(42 as unknown as SimulationTrace<CounterAction>)).toBe(0);
  });

  it('different actions produce different hashes', () => {
    const traceA: SimulationTrace<CounterAction> = {
      version: 1, adapterId: 't', adapterVersion: 1,
      scenarioFingerprint: 'fp', seed: 0, fixedDt: 1 / 60,
      actions: [{ delta: 1 }],
    };
    const traceB: SimulationTrace<CounterAction> = {
      version: 1, adapterId: 't', adapterVersion: 1,
      scenarioFingerprint: 'fp', seed: 0, fixedDt: 1 / 60,
      actions: [{ delta: 5 }],
    };
    expect(simulationTraceHash(traceA)).not.toBe(simulationTraceHash(traceB));
  });

  it('changed adapter version changes hash', () => {
    const trace1: SimulationTrace<CounterAction> = {
      version: 1, adapterId: 't', adapterVersion: 1,
      scenarioFingerprint: 'fp', seed: 0, fixedDt: 1 / 60, actions: [],
    };
    const trace2: SimulationTrace<CounterAction> = {
      version: 1, adapterId: 't', adapterVersion: 2,
      scenarioFingerprint: 'fp', seed: 0, fixedDt: 1 / 60, actions: [],
    };
    expect(simulationTraceHash(trace1)).not.toBe(simulationTraceHash(trace2));
  });

  it('changed scenario fingerprint changes hash', () => {
    const trace1: SimulationTrace<CounterAction> = {
      version: 1, adapterId: 't', adapterVersion: 1,
      scenarioFingerprint: 'fp1', seed: 0, fixedDt: 1 / 60, actions: [],
    };
    const trace2: SimulationTrace<CounterAction> = {
      version: 1, adapterId: 't', adapterVersion: 1,
      scenarioFingerprint: 'fp2', seed: 0, fixedDt: 1 / 60, actions: [],
    };
    expect(simulationTraceHash(trace1)).not.toBe(simulationTraceHash(trace2));
  });

  it('changed adapter id changes hash', () => {
    const trace1: SimulationTrace<CounterAction> = {
      version: 1, adapterId: 't1', adapterVersion: 1,
      scenarioFingerprint: 'fp', seed: 0, fixedDt: 1 / 60, actions: [],
    };
    const trace2: SimulationTrace<CounterAction> = {
      version: 1, adapterId: 't2', adapterVersion: 1,
      scenarioFingerprint: 'fp', seed: 0, fixedDt: 1 / 60, actions: [],
    };
    expect(simulationTraceHash(trace1)).not.toBe(simulationTraceHash(trace2));
  });
});
