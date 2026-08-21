import { describe, expect, it, vi } from 'vitest';
import { createLdtkHotReloadPlugin, LDTK_HOT_RELOAD_EVENT } from '../ldtk-hot-reload-plugin';

import type { ViteDevServerLike } from '../ldtk-hot-reload-plugin';

function fakeServer() {
  return {
    watcher: { add: vi.fn(), on: vi.fn() },
    ws: { send: vi.fn() },
  };
}

describe('createLdtkHotReloadPlugin', () => {
  it('watches the asset directory and forwards .ldtk saves over the websocket', () => {
    const server = fakeServer();
    const plugin = createLdtkHotReloadPlugin();
    expect(plugin.name).toBe('ldtk-hot-reload');
    expect(plugin.apply).toBe('serve'); // never runs in `vite build` / `preview`

    plugin.configureServer(server as unknown as ViteDevServerLike);
    expect(server.watcher.add).toHaveBeenCalledWith(expect.stringContaining('public'));

    const onChange = server.watcher.on.mock.calls.find(([event]) => event === 'change')?.[1];
    expect(onChange).toBeTypeOf('function');

    onChange!('/game/public/celerock.ldtk');
    expect(server.ws.send).toHaveBeenCalledWith(LDTK_HOT_RELOAD_EVENT, {
      file: '/game/public/celerock.ldtk',
    });

    onChange!('/game/public/celerock.png');
    onChange!('/game/src/main.ts');
    expect(server.ws.send).toHaveBeenCalledTimes(1); // .ldtk only
  });

  it('honors a custom directory and event name', () => {
    const server = fakeServer();
    const plugin = createLdtkHotReloadPlugin({ directory: 'assets', event: 'custom-event' });
    plugin.configureServer(server as unknown as ViteDevServerLike);
    expect(server.watcher.add).toHaveBeenCalledWith(expect.stringContaining('assets'));

    const onChange = server.watcher.on.mock.calls.find(([event]) => event === 'change')?.[1];
    onChange!('/game/assets/level.ldtk');
    expect(server.ws.send).toHaveBeenCalledWith('custom-event', { file: '/game/assets/level.ldtk' });
  });
});
