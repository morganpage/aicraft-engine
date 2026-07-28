/**
 * Tests for verifyScenario and playSimulationTrace.
 *
 * These tests use a minimal counter adapter: TState is a number (counter),
 * TAction is `{ delta: number }`. The outcome is 'success' when counter >= 100.
 */
import { describe, it, expect } from 'vitest';
import {
  verifyScenario,
  playSimulationTrace,
} from '../simtest';
import type {
  SimulationAdapter,
  SimulationPolicy,
  SimulationTrace,
} from '../simtest';

// ---------------------------------------------------------------------------
// Minimal counter adapters and policies
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
const SLOW_POLICY: SimulationPolicy<CounterState, CounterAction> = () => ({ delta: 1 });
const FAIL_POLICY: SimulationPolicy<CounterState, CounterAction> = () => ({ delta: -1 });
const STOP_POLICY: SimulationPolicy<CounterState, CounterAction> = () => undefined;
const INVALID_ACTION_POLICY: SimulationPolicy<CounterState, CounterAction> = () => ({ delta: 100 });
const THROWING_POLICY: SimulationPolicy<CounterState, CounterAction> = () => {
  throw new Error('policy exploded');
};

const BROKEN_CREATE_ADAPTER: SimulationAdapter<CounterState, CounterAction> = {
  ...COUNTER_ADAPTER,
  createInitialState: () => { throw new Error('create failed'); },
};

const BROKEN_ACTIONS_ADAPTER: SimulationAdapter<CounterState, CounterAction> = {
  ...COUNTER_ADAPTER,
  actions: () => { throw new Error('actions failed'); },
};

const BROKEN_STEP_ADAPTER: SimulationAdapter<CounterState, CounterAction> = {
  ...COUNTER_ADAPTER,
  step: () => { throw new Error('step failed'); },
};

const BROKEN_OUTCOME_ADAPTER: SimulationAdapter<CounterState, CounterAction> = {
  ...COUNTER_ADAPTER,
  outcome: () => { throw new Error('outcome failed'); },
};

// ---------------------------------------------------------------------------
// verifyScenario
// ---------------------------------------------------------------------------
describe('verifyScenario', () => {
  it('empty policies → inconclusive with diagnostic', () => {
    const result = verifyScenario(COUNTER_ADAPTER, { policies: [] });
    expect(result.version).toBe(1);
    expect(result.status).toBe('inconclusive');
    expect(result.runs).toHaveLength(0);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics[0].code).toBe('NO_POLICIES');
    expect(result.winningTrace).toBeUndefined();
  });

  it('successful policy → proven-success with winning trace', () => {
    const result = verifyScenario(COUNTER_ADAPTER, {
      maxTicks: 100,
      policies: [FAST_POLICY],
    });
    expect(result.status).toBe('proven-success');
    expect(result.runs).toHaveLength(1);
    expect(result.winningTrace).toBeDefined();
    expect(result.winningTraceHash).toBeGreaterThanOrEqual(0);
    expect(result.runs[0].termination).toBe('success');
    expect(result.runs[0].ticks).toBeGreaterThan(0);
    expect(result.runs[0].trace.actions.length).toBe(result.runs[0].ticks);
  });

  it('failing policy → inconclusive', () => {
    const result = verifyScenario(COUNTER_ADAPTER, {
      maxTicks: 100,
      policies: [FAIL_POLICY],
    });
    expect(result.status).toBe('inconclusive');
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].termination).toBe('failure');
    expect(result.runs[0].ticks).toBeGreaterThan(0);
  });

  it('tick-budget exhaustion → inconclusive', () => {
    const result = verifyScenario(COUNTER_ADAPTER, {
      maxTicks: 5,
      fixedDt: 1 / 60,
      policies: [SLOW_POLICY],
    });
    expect(result.status).toBe('inconclusive');
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].termination).toBe('tick-budget');
    expect(result.runs[0].ticks).toBe(5);
  });

  it('thrown adapter.createInitialState → inconclusive with diagnostic', () => {
    const result = verifyScenario(BROKEN_CREATE_ADAPTER, {
      maxTicks: 10,
      policies: [FAST_POLICY],
    });
    expect(result.status).toBe('inconclusive');
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].termination).toBe('adapter-error');
    expect(result.runs[0].ticks).toBe(0);
    expect(result.runs[0].diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(result.runs[0].diagnostics[0].code).toBe('ADAPTER_CREATE_INITIAL_STATE_ERROR');
  });

  it('thrown adapter.actions → inconclusive with diagnostic', () => {
    const result = verifyScenario(BROKEN_ACTIONS_ADAPTER, {
      maxTicks: 10,
      policies: [FAST_POLICY],
    });
    expect(result.status).toBe('inconclusive');
    expect(result.runs[0].termination).toBe('adapter-error');
    expect(result.runs[0].ticks).toBe(0);
    expect(result.runs[0].diagnostics[0].code).toBe('ADAPTER_ACTIONS_ERROR');
  });

  it('thrown adapter.step → inconclusive with diagnostic', () => {
    const result = verifyScenario(BROKEN_STEP_ADAPTER, {
      maxTicks: 10,
      policies: [FAST_POLICY],
    });
    expect(result.status).toBe('inconclusive');
    expect(result.runs[0].termination).toBe('adapter-error');
    expect(result.runs[0].diagnostics[0].code).toBe('ADAPTER_STEP_ERROR');
  });

  it('thrown adapter.outcome → inconclusive with diagnostic', () => {
    // Use a policy that ensures step doesn't throw, but outcome will throw
    const result = verifyScenario(BROKEN_OUTCOME_ADAPTER, {
      maxTicks: 10,
      policies: [FAST_POLICY],
    });
    expect(result.status).toBe('inconclusive');
    expect(result.runs[0].termination).toBe('adapter-error');
    // Outcome throws after step succeeds
    expect(result.runs[0].diagnostics[0].code).toBe('ADAPTER_OUTCOME_ERROR');
  });

  it('thrown policy callback → inconclusive with diagnostic', () => {
    const result = verifyScenario(COUNTER_ADAPTER, {
      maxTicks: 10,
      policies: [THROWING_POLICY],
    });
    expect(result.status).toBe('inconclusive');
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].termination).toBe('policy-stop');
    expect(result.runs[0].diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(result.runs[0].diagnostics[0].code).toBe('POLICY_ERROR');
  });

  it('invalid action (not in adapter.actions()) → inconclusive with diagnostic', () => {
    const result = verifyScenario(COUNTER_ADAPTER, {
      maxTicks: 10,
      policies: [INVALID_ACTION_POLICY],
    });
    expect(result.status).toBe('inconclusive');
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].termination).toBe('policy-stop');
    expect(result.runs[0].diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(result.runs[0].diagnostics[0].code).toBe('INVALID_ACTION');
    expect(result.runs[0].ticks).toBe(0);
  });

  it('policy-stop → inconclusive with diagnostic', () => {
    const result = verifyScenario(COUNTER_ADAPTER, {
      maxTicks: 10,
      policies: [STOP_POLICY],
    });
    expect(result.status).toBe('inconclusive');
    expect(result.runs[0].termination).toBe('policy-stop');
    expect(result.runs[0].diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(result.runs[0].diagnostics[0].code).toBe('POLICY_STOP');
  });

  it('multiple policies, one succeeds → proven-success', () => {
    const result = verifyScenario(COUNTER_ADAPTER, {
      maxTicks: 100,
      policies: [FAIL_POLICY, STOP_POLICY, FAST_POLICY, THROWING_POLICY],
    });
    expect(result.status).toBe('proven-success');
    expect(result.runs).toHaveLength(4);
    expect(result.winningTrace).toBeDefined();
    // The successful run is from FAST_POLICY (index 2)
    expect(result.runs[2].termination).toBe('success');
  });

  it('summarize is called when adapter provides it', () => {
    const adapterWithSummarize: SimulationAdapter<CounterState, CounterAction> = {
      ...COUNTER_ADAPTER,
      summarize: (state) => ({ value: state, doubled: state * 2 }),
    };
    const result = verifyScenario(adapterWithSummarize, {
      maxTicks: 100,
      policies: [FAST_POLICY],
    });
    expect(result.status).toBe('proven-success');
    expect(result.runs[0].summary).toBeDefined();
    expect(result.runs[0].summary!.value).toBe(100);
    expect(result.runs[0].summary!.doubled).toBe(200);
  });

  it('uses custom seed, fixedDt, maxTicks from config', () => {
    const result = verifyScenario(COUNTER_ADAPTER, {
      seed: 999,
      fixedDt: 1 / 30,
      maxTicks: 50,
      policies: [FAST_POLICY],
    });
    expect(result.status).toBe('proven-success');
    expect(result.runs[0].trace.seed).toBe(999);
    expect(result.runs[0].trace.fixedDt).toBe(1 / 30);
    expect(result.runs[0].ticks).toBeLessThanOrEqual(50);
  });
});

// ---------------------------------------------------------------------------
// playSimulationTrace
// ---------------------------------------------------------------------------
describe('playSimulationTrace', () => {
  it('plays back a valid trace successfully', () => {
    // First, get a winning trace
    const vr = verifyScenario(COUNTER_ADAPTER, {
      maxTicks: 100,
      policies: [FAST_POLICY],
    });
    const trace = vr.winningTrace!;

    // Play it back
    const result = playSimulationTrace(COUNTER_ADAPTER, trace);
    expect(result.valid).toBe(true);
    expect(result.state).toBeGreaterThanOrEqual(100);
    expect(result.outcome).toBe('success');
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects adapter id mismatch', () => {
    const trace = {
      version: 1 as const,
      adapterId: 'wrong-adapter',
      adapterVersion: 1,
      scenarioFingerprint: 'counter-fp-v1',
      seed: 0,
      fixedDt: 1 / 60,
      actions: [{ delta: 5 }, { delta: 5 }],
    };
    const result = playSimulationTrace(COUNTER_ADAPTER, trace);
    expect(result.valid).toBe(false);
    expect(result.state).toBeUndefined();
    expect(result.diagnostics[0].code).toBe('ADAPTER_ID_MISMATCH');
  });

  it('rejects adapter version mismatch', () => {
    const trace = {
      version: 1 as const,
      adapterId: 'counter-test',
      adapterVersion: 999,
      scenarioFingerprint: 'counter-fp-v1',
      seed: 0,
      fixedDt: 1 / 60,
      actions: [{ delta: 5 }],
    };
    const result = playSimulationTrace(COUNTER_ADAPTER, trace);
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0].code).toBe('ADAPTER_VERSION_MISMATCH');
  });

  it('rejects scenario fingerprint mismatch', () => {
    const trace = {
      version: 1 as const,
      adapterId: 'counter-test',
      adapterVersion: 1,
      scenarioFingerprint: 'wrong-fingerprint',
      seed: 0,
      fixedDt: 1 / 60,
      actions: [{ delta: 5 }],
    };
    const result = playSimulationTrace(COUNTER_ADAPTER, trace);
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0].code).toBe('SCENARIO_FINGERPRINT_MISMATCH');
  });

  it('handles null/undefined trace defensively', () => {
    const result1 = playSimulationTrace(COUNTER_ADAPTER, null as unknown as SimulationTrace<CounterAction>);
    expect(result1.valid).toBe(false);
    expect(result1.diagnostics[0].code).toBe('INVALID_TRACE');
  });

  it('trace zero actions is valid (just initial state)', () => {
    const trace: SimulationTrace<CounterAction> = {
      version: 1,
      adapterId: 'counter-test',
      adapterVersion: 1,
      scenarioFingerprint: 'counter-fp-v1',
      seed: 0,
      fixedDt: 1 / 60,
      actions: [],
    };
    const result = playSimulationTrace(COUNTER_ADAPTER, trace);
    expect(result.valid).toBe(true);
    expect(result.state).toBe(0);
    expect(result.outcome).toBe('running');
  });

  it('trace that leads to failure reports failure outcome', () => {
    const trace: SimulationTrace<CounterAction> = {
      version: 1,
      adapterId: 'counter-test',
      adapterVersion: 1,
      scenarioFingerprint: 'counter-fp-v1',
      seed: 0,
      fixedDt: 1 / 60,
      actions: [{ delta: -1 }],
    };
    const result = playSimulationTrace(COUNTER_ADAPTER, trace);
    expect(result.valid).toBe(true);
    expect(result.state).toBe(-1);
    expect(result.outcome).toBe('failure');
  });
});
