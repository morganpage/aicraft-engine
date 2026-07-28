/**
 * Type-level compile-time tests for simtest module.
 *
 * These tests verify that the type definitions compile correctly with
 * various type parameter combinations. They don't exercise runtime
 * behavior — they serve as a type-safety gate.
 */
import { describe, it, expect } from 'vitest';
import type {
  SimulationOutcome,
  SimulationTermination,
  SimulationPolicyContext,
  SimulationPolicy,
  SimulationTrace,
  SimulationRunResult,
  ScenarioVerificationResult,
  ScenarioTestConfig,
  SimulationPlaybackResult,
  SimulationDiagnostic,
  SimulationAdapter,
} from '../simtest';

// ---------------------------------------------------------------------------
// Type-level helpers: compile-time assertions using a sentinel type.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// SimulationOutcome
// ---------------------------------------------------------------------------
describe('SimulationOutcome', () => {
  it('accepts "running"', () => {
    const v: SimulationOutcome = 'running';
    expect(v).toBe('running');
  });
  it('accepts "success"', () => {
    const v: SimulationOutcome = 'success';
    expect(v).toBe('success');
  });
  it('accepts "failure"', () => {
    const v: SimulationOutcome = 'failure';
    expect(v).toBe('failure');
  });
});

// ---------------------------------------------------------------------------
// SimulationTermination
// ---------------------------------------------------------------------------
describe('SimulationTermination', () => {
  it('accepts all five values', () => {
    const values: SimulationTermination[] = [
      'success',
      'failure',
      'tick-budget',
      'policy-stop',
      'adapter-error',
    ];
    expect(values).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// SimulationPolicyContext
// ---------------------------------------------------------------------------
describe('SimulationPolicyContext', () => {
  it('works with string action type', () => {
    const ctx: SimulationPolicyContext<string> = {
      tick: 0,
      fixedDt: 1 / 60,
      seed: 42,
      actions: ['left', 'right'],
    };
    expect(ctx.tick).toBe(0);
    expect(ctx.actions).toContain('left');
  });

  it('works with complex action type', () => {
    interface MyAction {
      readonly moveX: -1 | 0 | 1;
      readonly flip: boolean;
    }
    const ctx: SimulationPolicyContext<MyAction> = {
      tick: 10,
      fixedDt: 1 / 60,
      seed: 99,
      actions: [{ moveX: 1, flip: false }, { moveX: -1, flip: true }],
    };
    expect(ctx.actions[0].moveX).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// SimulationPolicy
// ---------------------------------------------------------------------------
describe('SimulationPolicy', () => {
  it('is callable with correct signature', () => {
    interface S { x: number }
    interface A { dir: -1 | 0 | 1 }

    // A policy that always moves right.
    const policy: SimulationPolicy<S, A> = (state, _ctx) => {
      if (state.x > 100) return undefined;
      return { dir: 1 };
    };

    const ctx: SimulationPolicyContext<A> = {
      tick: 0,
      fixedDt: 1 / 60,
      seed: 0,
      actions: [{ dir: -1 }, { dir: 0 }, { dir: 1 }],
    };

    const result = policy({ x: 0 }, ctx);
    expect(result).toEqual({ dir: 1 });

    const stopped = policy({ x: 101 }, ctx);
    expect(stopped).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SimulationTrace
// ---------------------------------------------------------------------------
describe('SimulationTrace', () => {
  it('has version=1 and all required fields', () => {
    const trace: SimulationTrace<string> = {
      version: 1,
      adapterId: 'test-adapter',
      adapterVersion: 1,
      scenarioFingerprint: 'abc123',
      seed: 42,
      fixedDt: 1 / 60,
      actions: ['left', 'right'],
    };
    expect(trace.version).toBe(1);
    expect(trace.actions.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// SimulationRunResult
// ---------------------------------------------------------------------------
describe('SimulationRunResult', () => {
  it('carries version, termination, ticks, trace, and diagnostics', () => {
    const trace: SimulationTrace<number> = {
      version: 1,
      adapterId: 'a',
      adapterVersion: 1,
      scenarioFingerprint: 'f',
      seed: 0,
      fixedDt: 1 / 60,
      actions: [1, 2, 3],
    };
    const result: SimulationRunResult<number> = {
      version: 1,
      termination: 'success',
      ticks: 3,
      trace,
      diagnostics: [],
    };
    expect(result.termination).toBe('success');
  });

  it('accepts optional summary', () => {
    const trace: SimulationTrace<string> = {
      version: 1, adapterId: 'a', adapterVersion: 1,
      scenarioFingerprint: 'f', seed: 0, fixedDt: 1 / 60, actions: [],
    };
    const result: SimulationRunResult<string> = {
      version: 1,
      termination: 'failure',
      ticks: 5,
      trace,
      summary: { reason: 'fell_off' },
      diagnostics: [],
    };
    expect(result.summary?.reason).toBe('fell_off');
  });
});

// ---------------------------------------------------------------------------
// ScenarioVerificationResult
// ---------------------------------------------------------------------------
describe('ScenarioVerificationResult', () => {
  it('can be proven-success with a winning trace', () => {
    const trace: SimulationTrace<number> = {
      version: 1, adapterId: 'a', adapterVersion: 1,
      scenarioFingerprint: 'f', seed: 0, fixedDt: 1 / 60, actions: [],
    };
    const vr: ScenarioVerificationResult<number> = {
      version: 1,
      status: 'proven-success',
      runs: [],
      winningTrace: trace,
      winningTraceHash: 12345,
      diagnostics: [],
    };
    expect(vr.status).toBe('proven-success');
    expect(vr.winningTraceHash).toBe(12345);
  });

  it('can be inconclusive without a winning trace', () => {
    const vr: ScenarioVerificationResult<string> = {
      version: 1,
      status: 'inconclusive',
      runs: [],
      diagnostics: [],
    };
    expect(vr.status).toBe('inconclusive');
    expect(vr.winningTrace).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ScenarioTestConfig
// ---------------------------------------------------------------------------
describe('ScenarioTestConfig', () => {
  it('accepts optional seed, fixedDt, maxTicks', () => {
    const policy: SimulationPolicy<{ x: number }, string> = () => 'right';
    const config: ScenarioTestConfig<{ x: number }, string> = {
      seed: 42,
      fixedDt: 1 / 60,
      maxTicks: 1000,
      policies: [policy],
    };
    expect(config.policies.length).toBe(1);
  });

  it('minimal config works with just policies', () => {
    const config: ScenarioTestConfig<{}, string> = {
      policies: [],
    };
    expect(config.policies).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SimulationPlaybackResult
// ---------------------------------------------------------------------------
describe('SimulationPlaybackResult', () => {
  it('tracks valid, state, outcome, diagnostics', () => {
    const r: SimulationPlaybackResult<number> = {
      valid: true,
      state: 42,
      outcome: 'running',
      diagnostics: [],
    };
    expect(r.valid).toBe(true);
    expect(r.state).toBe(42);
  });

  it('allows missing state and outcome on failed validation', () => {
    const r: SimulationPlaybackResult<string> = {
      valid: false,
      diagnostics: [{ severity: 'error', code: 'BAD', message: 'bad' }],
    };
    expect(r.valid).toBe(false);
    expect(r.state).toBeUndefined();
    expect(r.outcome).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SimulationDiagnostic
// ---------------------------------------------------------------------------
describe('SimulationDiagnostic', () => {
  it('accepts tick as optional', () => {
    const d1: SimulationDiagnostic = { severity: 'error', code: 'ERR', message: 'err' };
    const d2: SimulationDiagnostic = { severity: 'warning', code: 'WARN', message: 'warn', tick: 5 };
    const d3: SimulationDiagnostic = { severity: 'info', code: 'INFO', message: 'info' };
    expect(d1.tick).toBeUndefined();
    expect(d2.tick).toBe(5);
    expect(d3.severity).toBe('info');
  });
});

// ---------------------------------------------------------------------------
// SimulationAdapter (compile-time structural check)
// ---------------------------------------------------------------------------
describe('SimulationAdapter', () => {
  it('structural type is assignable from a concrete adapter', () => {
    interface MyState { x: number }
    interface MyAction { dir: -1 | 0 | 1 }

    const adapter: SimulationAdapter<MyState, MyAction> = {
      id: 'my-test',
      version: 1,
      scenarioFingerprint: 'test-fp',
      createInitialState: (seed: number) => ({ x: seed }),
      actions: (state) => state.x > 50
        ? [{ dir: 0 } as const]
        : [{ dir: -1 }, { dir: 0 }, { dir: 1 }] as const,
      step: (state, action) => ({ x: state.x + action.dir }),
      outcome: (state) => state.x >= 100 ? 'success' : 'running',
    };

    const s = adapter.createInitialState(10);
    expect(s.x).toBe(10);
    expect(adapter.outcome(s)).toBe('running');
  });

  it('optional methods stateKey and summarize are detected as optional', () => {
    interface S { id: string }
    interface A { n: number }

    // Without optional methods
    const a1: SimulationAdapter<S, A> = {
      id: 'a', version: 1, scenarioFingerprint: 'fp',
      createInitialState: () => ({ id: '' }),
      actions: () => [],
      step: (s) => s,
      outcome: () => 'running',
    };

    // With optional methods
    const a2: SimulationAdapter<S, A> = {
      ...a1,
      stateKey: (s) => s.id,
      summarize: (s) => ({ id: s.id }),
    };

    expect(a1.stateKey).toBeUndefined();
    expect(typeof a2.stateKey).toBe('function');
    expect(a2.summarize!({ id: 'x' })).toEqual({ id: 'x' });
  });
});
