import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadLdtkProjectAssets } from '../ldtk/load';
import type { LdtkAssetDiagnostic, LoadLdtkProjectAssetsOptions } from '../ldtk/load';
import type { LdtkProject } from '../ldtk/types';

/** Path to the adversarial Celerock fixture (space + brackets relPath). */
const FIXTURE_PATH = fileURLToPath(
  new URL('./fixtures/celerock-adversarial.ldtk', import.meta.url),
);
const FIXTURE_TEXT = readFileSync(FIXTURE_PATH, 'utf8');

/**
 * Build a minimal fake `Response` for the injected fetch. Cast through
 * `unknown` to `Response` — only the fields the loader touches are populated,
 * which keeps the stub DOM-free (no real fetch / Response in the Node env).
 */
function fakeResponse(opts: {
  readonly text?: string;
  readonly bytes?: Uint8Array;
  readonly status?: number;
}): Response {
  const status = opts.status ?? 200;
  const ok = status >= 200 && status < 300;
  return {
    ok,
    status,
    statusText: '',
    type: 'basic',
    url: '',
    redirected: false,
    headers: new Map(),
    body: null,
    bodyUsed: false,
    clone() {
      return fakeResponse(opts);
    },
    text: () => Promise.resolve(opts.text ?? ''),
    json: () => Promise.resolve(JSON.parse(opts.text ?? 'null')),
    arrayBuffer: () =>
      Promise.resolve((opts.bytes ?? new Uint8Array()).buffer.slice(0)),
    blob: () => Promise.resolve({} as Blob),
    formData: () => Promise.resolve({} as FormData),
  } as unknown as Response;
}

/** A throwaway drawable stand-in (the loader never inspects it). */
const FAKE_IMAGE = {} as CanvasImageSource;

describe('loadLdtkProjectAssets', () => {
  it('loads a project + decodes tilesets; encodes space+brackets in the URL', async () => {
    const fetchedUrls: string[] = [];
    const fetchStub: LoadLdtkProjectAssetsOptions['fetch'] = (input) => {
      const urlStr =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : String(input);
      fetchedUrls.push(urlStr);
      if (urlStr.endsWith('proj.ldtk')) {
        return Promise.resolve(fakeResponse({ text: FIXTURE_TEXT }));
      }
      if (urlStr.includes('tranquil')) {
        return Promise.resolve(fakeResponse({ bytes: new Uint8Array([1, 2, 3, 4]) }));
      }
      return Promise.resolve(fakeResponse({ text: 'not found', status: 404 }));
    };
    const decodeCalls: { uid: number; relPath: string }[] = [];

    const result = await loadLdtkProjectAssets({
      projectUrl: 'https://example.test/levels/proj.ldtk',
      fetch: fetchStub,
      decodeImage: (bytes, def) => {
        decodeCalls.push({ uid: def.uid, relPath: def.relPath ?? '' });
        expect(bytes.length).toBe(4);
        return Promise.resolve(FAKE_IMAGE);
      },
      imageTimeoutMs: 1000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.levels.length).toBeGreaterThanOrEqual(1);
    expect(result.tilesets.size).toBe(1);
    expect(decodeCalls).toHaveLength(1);

    // The whole point of B1: spaces and brackets MUST be percent-encoded in
    // the URL the host fetch receives (a raw concat hung boot in real builds).
    const tilesetUrl = fetchedUrls.find((u) => u.includes('tranquil'));
    expect(tilesetUrl).toBeDefined();
    expect(tilesetUrl).toContain('%5Bv1%5D%20tranquil');
    expect(tilesetUrl).not.toContain('[v1]');
    expect(tilesetUrl).not.toContain(' ');
  });

  it('succeeds with a warning when an optional tileset is missing', async () => {
    // A 2-tileset project: A loads, B 404s.
    const projectJson = JSON.stringify({
      iid: 'p',
      jsonVersion: '1.5.3',
      bgColor: '#000000',
      worldLayout: null,
      worldGridWidth: null,
      worldGridHeight: null,
      externalLevels: false,
      worlds: [],
      defs: {
        layers: [],
        enums: [],
        entities: [],
        tilesets: [
          { identifier: 'A', uid: 1, relPath: 'a.png', pxWid: 16, pxHei: 16, tileGridSize: 8, __cWid: 2, __cHei: 2, embedAtlas: null },
          { identifier: 'B', uid: 2, relPath: 'b.png', pxWid: 16, pxHei: 16, tileGridSize: 8, __cWid: 2, __cHei: 2, embedAtlas: null },
        ],
      },
      levels: [],
    });

    const fetchStub: LoadLdtkProjectAssetsOptions['fetch'] = (input) => {
      const urlStr = input instanceof URL ? input.href : String(input);
      if (urlStr.endsWith('proj.ldtk')) {
        return Promise.resolve(fakeResponse({ text: projectJson }));
      }
      if (urlStr.endsWith('a.png')) {
        return Promise.resolve(fakeResponse({ bytes: new Uint8Array([9]) }));
      }
      return Promise.resolve(fakeResponse({ status: 404, text: 'missing' }));
    };

    const result = await loadLdtkProjectAssets({
      projectUrl: 'https://example.test/proj.ldtk',
      fetch: fetchStub,
      decodeImage: () => Promise.resolve(FAKE_IMAGE),
      imageTimeoutMs: 1000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tilesets.size).toBe(1);
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings.length).toBe(1);
    expect(warnings[0].tilesetUid).toBe(2);
    expect(warnings[0].message).toMatch(/fetch failed/i);
  });

  it('returns ok:false on a parse failure', async () => {
    const fetchStub: LoadLdtkProjectAssetsOptions['fetch'] = () =>
      Promise.resolve(fakeResponse({ text: '{ not valid json' }));

    const result = await loadLdtkProjectAssets({
      projectUrl: 'https://example.test/proj.ldtk',
      fetch: fetchStub,
      decodeImage: () => Promise.resolve(FAKE_IMAGE),
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('bounds a never-resolving decode with imageTimeoutMs and continues', async () => {
    const projectJson = JSON.stringify({
      iid: 'p',
      jsonVersion: '1.5.3',
      bgColor: '#000000',
      worldLayout: null,
      worldGridWidth: null,
      worldGridHeight: null,
      externalLevels: false,
      worlds: [],
      defs: {
        layers: [],
        enums: [],
        entities: [],
        tilesets: [
          { identifier: 'A', uid: 1, relPath: 'a.png', pxWid: 16, pxHei: 16, tileGridSize: 8, __cWid: 2, __cHei: 2, embedAtlas: null },
          { identifier: 'B', uid: 2, relPath: 'b.png', pxWid: 16, pxHei: 16, tileGridSize: 8, __cWid: 2, __cHei: 2, embedAtlas: null },
        ],
      },
      levels: [],
    });
    const fetchStub: LoadLdtkProjectAssetsOptions['fetch'] = (input) => {
      const urlStr = input instanceof URL ? input.href : String(input);
      if (urlStr.endsWith('proj.ldtk')) {
        return Promise.resolve(fakeResponse({ text: projectJson }));
      }
      return Promise.resolve(fakeResponse({ bytes: new Uint8Array([1]) }));
    };

    const start = Date.now();
    const result = await loadLdtkProjectAssets({
      projectUrl: 'https://example.test/proj.ldtk',
      fetch: fetchStub,
      // A decodes instantly; B never resolves (bounded by the tiny timeout).
      decodeImage: (_bytes, def) =>
        def.identifier === 'A'
          ? Promise.resolve(FAKE_IMAGE)
          : new Promise<CanvasImageSource | undefined>(() => {}),
      imageTimeoutMs: 15,
    });
    const elapsed = Date.now() - start;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tilesets.size).toBe(1); // only A
    const timeouts = result.diagnostics.filter(
      (d: LdtkAssetDiagnostic) => d.severity === 'warning' && /timed out/i.test(d.message),
    );
    expect(timeouts.length).toBe(1);
    expect(timeouts[0].tilesetUid).toBe(2);
    // Never hangs: a 15ms cap must resolve well under a second.
    expect(elapsed).toBeLessThan(1000);
  });

  it('returns ok:false when every candidate tileset fails to decode', async () => {
    const projectJson = JSON.stringify({
      iid: 'p',
      jsonVersion: '1.5.3',
      bgColor: '#000000',
      worldLayout: null,
      worldGridWidth: null,
      worldGridHeight: null,
      externalLevels: false,
      worlds: [],
      defs: {
        layers: [],
        enums: [],
        entities: [],
        tilesets: [
          { identifier: 'A', uid: 1, relPath: 'a.png', pxWid: 16, pxHei: 16, tileGridSize: 8, __cWid: 2, __cHei: 2, embedAtlas: null },
        ],
      },
      levels: [],
    });
    const fetchStub: LoadLdtkProjectAssetsOptions['fetch'] = (input) => {
      const urlStr = input instanceof URL ? input.href : String(input);
      if (urlStr.endsWith('proj.ldtk')) {
        return Promise.resolve(fakeResponse({ text: projectJson }));
      }
      return Promise.resolve(fakeResponse({ bytes: new Uint8Array([1]) }));
    };

    const start = Date.now();
    const result = await loadLdtkProjectAssets({
      projectUrl: 'https://example.test/proj.ldtk',
      fetch: fetchStub,
      decodeImage: () => new Promise<CanvasImageSource | undefined>(() => {}),
      imageTimeoutMs: 10,
    });
    const elapsed = Date.now() - start;

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });

  it('fails fast (ok:false) when no fetch is available', async () => {
    // Node 18+ ships globalThis.fetch, so temporarily remove it to exercise
    // the no-fetch defensive path, then restore it unconditionally.
    const fetchHolder = globalThis as { fetch?: typeof globalThis.fetch };
    const orig = fetchHolder.fetch;
    fetchHolder.fetch = undefined;
    try {
      const result = await loadLdtkProjectAssets({
        projectUrl: 'https://example.test/proj.ldtk',
        decodeImage: () => Promise.resolve(FAKE_IMAGE),
      });
      expect(result.ok).toBe(false);
      expect(result.diagnostics.some((d) => /no fetch/i.test(d.message))).toBe(true);
    } finally {
      fetchHolder.fetch = orig;
    }
  });

  it('degrades gracefully when the default decoder has no host APIs (Node)', async () => {
    // Inject fetch but NOT decodeImage: the default decoder finds neither
    // createImageBitmap nor Image under Node, resolves undefined, and the
    // loader reports ok:false with a warning — never throws, never hangs.
    const fetchStub: LoadLdtkProjectAssetsOptions['fetch'] = (input) => {
      const urlStr = input instanceof URL ? input.href : String(input);
      if (urlStr.endsWith('proj.ldtk')) {
        return Promise.resolve(fakeResponse({ text: FIXTURE_TEXT }));
      }
      return Promise.resolve(fakeResponse({ bytes: new Uint8Array([1, 2]) }));
    };

    const result = await loadLdtkProjectAssets({
      projectUrl: 'https://example.test/proj.ldtk',
      fetch: fetchStub,
      imageTimeoutMs: 500,
      // decodeImage intentionally omitted.
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((d) => d.severity === 'warning')).toBe(true);
  });

  it('honours an explicit assetBaseUrl', async () => {
    const fetchedUrls: string[] = [];
    const fetchStub: LoadLdtkProjectAssetsOptions['fetch'] = (input) => {
      const urlStr = input instanceof URL ? input.href : String(input);
      fetchedUrls.push(urlStr);
      if (urlStr.endsWith('proj.ldtk')) {
        return Promise.resolve(fakeResponse({ text: FIXTURE_TEXT }));
      }
      return Promise.resolve(fakeResponse({ bytes: new Uint8Array([1]) }));
    };

    const result = await loadLdtkProjectAssets({
      projectUrl: 'https://example.test/levels/proj.ldtk',
      assetBaseUrl: 'https://cdn.example.test/art/',
      fetch: fetchStub,
      decodeImage: () => Promise.resolve(FAKE_IMAGE),
      imageTimeoutMs: 500,
    });

    expect(result.ok).toBe(true);
    // The tileset resolved against the CDN host (the relPath's `../` then
    // climbs above `art/`, which is standard URL semantics — what matters is
    // the host swap proving assetBaseUrl was used as the base).
    const tilesetUrl = fetchedUrls.find((u) => u.includes('tranquil'));
    expect(tilesetUrl).toBeDefined();
    expect(tilesetUrl).toMatch(/^https:\/\/cdn\.example\.test\//);
  });

  it('does not throw when the project type is structurally unexpected', async () => {
    // A well-formed project with zero tilesets → ok:true, empty bundle, info.
    const emptyProject = JSON.stringify({
      iid: 'p',
      jsonVersion: '1.5.3',
      bgColor: '#000000',
      worldLayout: null,
      worldGridWidth: null,
      worldGridHeight: null,
      externalLevels: false,
      worlds: [],
      defs: { layers: [], enums: [], entities: [], tilesets: [] },
      levels: [],
    } satisfies LdtkProject);

    const fetchStub: LoadLdtkProjectAssetsOptions['fetch'] = (input) => {
      const urlStr = input instanceof URL ? input.href : String(input);
      if (urlStr.endsWith('proj.ldtk')) {
        return Promise.resolve(fakeResponse({ text: emptyProject }));
      }
      return Promise.resolve(fakeResponse({ status: 404 }));
    };

    const result = await loadLdtkProjectAssets({
      projectUrl: 'https://example.test/proj.ldtk',
      fetch: fetchStub,
      decodeImage: () => Promise.resolve(FAKE_IMAGE),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tilesets.size).toBe(0);
  });
});

describe('loadLdtkProjectAssets — E1 relative project URLs', () => {
  /**
   * Install/restore simulated host globals (the loader reads
   * `document.baseURI` / `location.href` lazily and defensively). Passing
   * `undefined` for a field removes it (the Node default); the restore puts
   * back exactly what was there.
   */
  function installHost(host: { document?: unknown; location?: unknown }): () => void {
    const g = globalThis as Record<string, unknown>;
    const hadDoc = 'document' in g;
    const hadLoc = 'location' in g;
    const oldDoc = g.document;
    const oldLoc = g.location;
    if (host.document === undefined) delete g.document;
    else g.document = host.document;
    if (host.location === undefined) delete g.location;
    else g.location = host.location;
    return () => {
      if (hadDoc) g.document = oldDoc;
      else delete g.document;
      if (hadLoc) g.location = oldLoc;
      else delete g.location;
    };
  }

  /** fetch stub serving the adversarial fixture project + its tileset. */
  function fixtureFetch(log: string[]): LoadLdtkProjectAssetsOptions['fetch'] {
    return (input) => {
      const urlStr = input instanceof URL ? input.href : String(input);
      log.push(urlStr);
      if (urlStr.endsWith('proj.ldtk') || urlStr.endsWith('game.ldtk') || urlStr.endsWith('level.ldtk')) {
        return Promise.resolve(fakeResponse({ text: FIXTURE_TEXT }));
      }
      if (urlStr.includes('tranquil')) {
        return Promise.resolve(fakeResponse({ bytes: new Uint8Array([1, 2, 3, 4]) }));
      }
      return Promise.resolve(fakeResponse({ text: 'not found', status: 404 }));
    };
  }

  it('resolves a relative projectUrl against document.baseURI (simulated browser)', async () => {
    const restore = installHost({ document: { baseURI: 'https://cdn.example/app/levels/' } });
    const fetched: string[] = [];
    try {
      const result = await loadLdtkProjectAssets({
        projectUrl: './proj.ldtk',
        fetch: fixtureFetch(fetched),
        decodeImage: () => Promise.resolve(FAKE_IMAGE),
        imageTimeoutMs: 1000,
      });
      expect(result.ok).toBe(true);
      // The documented golden-path relative call resolves to the base URI.
      expect(fetched[0]).toBe('https://cdn.example/app/levels/proj.ldtk');
      // Tileset relPaths still encode spaces/brackets against the resolved base.
      const tilesetUrl = fetched.find((u) => u.includes('tranquil'));
      expect(tilesetUrl).toContain('%5Bv1%5D%20tranquil');
      expect(tilesetUrl).not.toContain('[v1]');
    } finally {
      restore();
    }
  });

  it('resolves `..` segments and falls back to location.href without a document', async () => {
    const restore = installHost({ location: { href: 'https://fallback.test/game/src/index.html' } });
    const fetched: string[] = [];
    try {
      const result = await loadLdtkProjectAssets({
        projectUrl: '../levels/proj.ldtk',
        fetch: fixtureFetch(fetched),
        decodeImage: () => Promise.resolve(FAKE_IMAGE),
      });
      expect(result.ok).toBe(true);
      expect(fetched[0]).toBe('https://fallback.test/game/levels/proj.ldtk');
    } finally {
      restore();
    }
  });

  it('fails diagnostically (ok:false) in Node/SSR with no host base', async () => {
    const restore = installHost({});
    try {
      const result = await loadLdtkProjectAssets({
        projectUrl: './levels/level.ldtk',
        fetch: fixtureFetch([]),
        decodeImage: () => Promise.resolve(FAKE_IMAGE),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const msg = result.diagnostics.map((d) => d.message).join(' | ');
      expect(msg).toContain('invalid projectUrl: ./levels/level.ldtk');
      expect(msg).toContain('host base');
    } finally {
      restore();
    }
  });

  it('absolute URLs win over any host base (never rebased)', async () => {
    const restore = installHost({ document: { baseURI: 'https://evil.example/' } });
    const fetched: string[] = [];
    try {
      const result = await loadLdtkProjectAssets({
        projectUrl: 'https://example.test/levels/proj.ldtk',
        fetch: fixtureFetch(fetched),
        decodeImage: () => Promise.resolve(FAKE_IMAGE),
      });
      expect(result.ok).toBe(true);
      expect(fetched[0]).toBe('https://example.test/levels/proj.ldtk');
      expect(fetched[0]).not.toContain('evil.example');
    } finally {
      restore();
    }
  });

  it('accepts a URL object and an absolute file: URL with injected fetch', async () => {
    const restore = installHost({});
    const fetched: string[] = [];
    try {
      const byObject = await loadLdtkProjectAssets({
        projectUrl: new URL('https://example.test/levels/proj.ldtk'),
        fetch: fixtureFetch(fetched),
        decodeImage: () => Promise.resolve(FAKE_IMAGE),
      });
      expect(byObject.ok).toBe(true);

      const byFile = await loadLdtkProjectAssets({
        projectUrl: new URL('file:///levels/proj.ldtk'),
        fetch: fixtureFetch(fetched),
        decodeImage: () => Promise.resolve(FAKE_IMAGE),
      });
      expect(byFile.ok).toBe(true);
      expect(fetched).toContain('file:///levels/proj.ldtk');
    } finally {
      restore();
    }
  });
});
