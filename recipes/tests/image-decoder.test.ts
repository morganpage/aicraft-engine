import { describe, expect, it } from 'vitest';
import {
  decodeImageBounded,
  decodeImageBytesBounded,
  type DecodeImageElement,
} from '../image-decoder';

const fakeImage = { width: 8, height: 8 } as CanvasImageSource;

/** Stub the object-URL API on the global URL for the duration of `body`. */
async function withObjectUrls<T>(body: () => Promise<T>): Promise<T> {
  const url = (globalThis as { URL?: { createObjectURL?: unknown; revokeObjectURL?: unknown } }).URL!;
  const originalCreate = url.createObjectURL;
  const originalRevoke = url.revokeObjectURL;
  let revoked: string | undefined;
  (url as { createObjectURL?: unknown }).createObjectURL = () => 'blob:stub';
  (url as { revokeObjectURL?: unknown }).revokeObjectURL = (token: string) => {
    revoked = token;
  };
  try {
    const result = await body();
    expect(revoked).toBe('blob:stub'); // the object URL is always revoked
    return result;
  } finally {
    (url as { createObjectURL?: unknown }).createObjectURL = originalCreate;
    (url as { revokeObjectURL?: unknown }).revokeObjectURL = originalRevoke;
  }
}

describe('decodeImageBytesBounded', () => {
  it('resolves through the bitmap host', async () => {
    const result = await decodeImageBytesBounded(new Uint8Array([1, 2, 3]), {
      createBitmap: async () => fakeImage,
    });
    expect(result).toBe(fakeImage);
  });

  it('returns undefined when the host hangs past timeoutMs', async () => {
    const result = await decodeImageBytesBounded(new Uint8Array([1]), {
      timeoutMs: 10,
      createBitmap: () => new Promise<CanvasImageSource>(() => {}),
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when the host rejects', async () => {
    const result = await decodeImageBytesBounded(new Uint8Array([1]), {
      createBitmap: async () => {
        throw new Error('host exploded');
      },
    });
    expect(result).toBeUndefined();
  });

  it('falls back to the <img> path when the bitmap host yields nothing', async () => {
    await withObjectUrls(async () => {
      const element = { src: '', decode: async () => {} } as DecodeImageElement & CanvasImageSource;
      const result = await decodeImageBytesBounded(new Uint8Array([1]), {
        createBitmap: async () => undefined,
        createImageElement: () => element,
      });
      expect(result).toBe(element);
      expect(element.src).toBe('blob:stub');
    });
  });

  it('treats a hung <img> decode as a failure, not a half-decoded image', async () => {
    await withObjectUrls(async () => {
      const element = {
        src: '',
        decode: () => new Promise<void>(() => {}),
      } as DecodeImageElement & CanvasImageSource;
      const result = await decodeImageBytesBounded(new Uint8Array([1]), {
        timeoutMs: 10,
        createBitmap: async () => undefined,
        createImageElement: () => element,
      });
      expect(result).toBeUndefined();
    });
  });

  it('returns undefined with no hosts at all (Node: no createImageBitmap, no Image)', async () => {
    const result = await decodeImageBytesBounded(new Uint8Array([1]));
    expect(result).toBeUndefined();
  });

  it('accepts an ArrayBuffer as readily as a Uint8Array', async () => {
    const result = await decodeImageBytesBounded(new Uint8Array([9, 9]).buffer, {
      createBitmap: async () => fakeImage,
    });
    expect(result).toBe(fakeImage);
  });
});

describe('decodeImageBounded', () => {
  const bytes = new Uint8Array([1, 2, 3]);

  it('fetches, then decodes through the bitmap host', async () => {
    const result = await decodeImageBounded('https://example.invalid/sheet.png', {
      fetch: async () => ({ ok: true, arrayBuffer: async () => bytes.buffer }),
      createBitmap: async () => fakeImage,
    });
    expect(result).toBe(fakeImage);
  });

  it('returns undefined on a non-ok response', async () => {
    const result = await decodeImageBounded('https://example.invalid/missing.png', {
      fetch: async () => ({ ok: false, arrayBuffer: async () => bytes.buffer }),
      createBitmap: async () => fakeImage,
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when fetch throws', async () => {
    const result = await decodeImageBounded('https://example.invalid/explodes.png', {
      fetch: async () => {
        throw new Error('network gone');
      },
      createBitmap: async () => fakeImage,
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined with no ambient fetch (Node without a stub)', async () => {
    const ambient = (globalThis as { fetch?: unknown }).fetch;
    delete (globalThis as { fetch?: unknown }).fetch;
    try {
      const result = await decodeImageBounded('https://example.invalid/sheet.png');
      expect(result).toBeUndefined();
    } finally {
      (globalThis as { fetch?: unknown }).fetch = ambient;
    }
  });
});
