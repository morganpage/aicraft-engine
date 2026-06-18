import { vi } from 'vitest';

/**
 * Minimal mock for `CanvasRenderingContext2D` for testing draw primitives.
 *
 * The surface used by `outlineRect` (fill/stroke) and `drawRig`
 * (save/transform/restore) is mocked. Add fields as more primitives are
 * added. The mock records calls via `vi.fn()` so tests can assert on
 * `fillStyle`, `strokeStyle`, `lineWidth`, and the args of `fillRect` /
 * `strokeRect` / `save` / `transform` / `restore`.
 */
export interface MockCtx {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  fillRect: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  transform: ReturnType<typeof vi.fn>;
}

export function createMockCtx(): MockCtx {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    transform: vi.fn(),
  };
}
