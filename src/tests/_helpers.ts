import { vi } from 'vitest';

/**
 * Minimal mock for `CanvasRenderingContext2D` for testing draw primitives.
 *
 * The surface used by `outlineRect` (fill/stroke), `drawRig`
 * (save/transform/restore), and `drawGlow` (radial gradient + additive
 * blend) is mocked. Add fields as more primitives are added. The mock
 * records calls via `vi.fn()` so tests can assert on `fillStyle`,
 * `strokeStyle`, `lineWidth`, `globalCompositeOperation`, and the args of
 * `fillRect` / `strokeRect` / `save` / `transform` / `restore` /
 * `createRadialGradient` / `beginPath` / `arc` / `fill`.
 */
export interface MockCtx {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalCompositeOperation: string;
  fillRect: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  transform: ReturnType<typeof vi.fn>;
  createRadialGradient: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  arc: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
}

export function createMockCtx(): MockCtx {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalCompositeOperation: 'source-over',
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    transform: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
  };
}
