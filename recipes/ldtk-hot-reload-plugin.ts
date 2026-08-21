import { resolve } from 'node:path';

/**
 * The dev-server event the plugin emits on a `.ldtk` save. The client handler
 * listens for exactly this name (`import.meta.hot.on(LDTK_HOT_RELOAD_EVENT, …)`).
 */
export const LDTK_HOT_RELOAD_EVENT = 'ldtk:update' as const;

/** The subset of Vite's dev server the plugin touches (structural — no `vite`
 * import, so the recipe stays dependency-free and engine-only by convention). */
export interface ViteDevServerLike {
  readonly watcher: {
    add(path: string | readonly string[]): unknown;
    on(event: string, listener: (file: string) => void): unknown;
  };
  readonly ws: { send(event: string, payload: unknown): void };
}

/** The plugin object — drop into `defineConfig({ plugins: [ … ] })`. */
export interface LdtkHotReloadPlugin {
  readonly name: 'ldtk-hot-reload';
  readonly apply: 'serve';
  configureServer(server: ViteDevServerLike): void;
}

/** Options for {@link createLdtkHotReloadPlugin}. */
export interface LdtkHotReloadPluginOptions {
  /** The watched asset directory, resolved against the vite root. Default `'public'`. */
  readonly directory?: string;
  /** The websocket event name. Default {@link LDTK_HOT_RELOAD_EVENT}. */
  readonly event?: string;
}

/**
 * The Vite dev-server watcher for LDtk hot reload.
 *
 * Vite does not put `public/` assets through HMR (they sit outside the module
 * graph), so live level editing needs the game to be notified itself: this
 * plugin adds the asset directory to the dev-server watcher and forwards every
 * saved `.ldtk` file to the client over the dev websocket as
 * {@link LDTK_HOT_RELOAD_EVENT}. `apply: 'serve'` keeps it out of
 * `vite build` / `vite preview` entirely.
 *
 * The transactional client swap (re-load, rebuild caches, commit atomically)
 * is game-owned — see the celerock brief §5.7 for the reference pattern.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from 'vite';
 * import { createLdtkHotReloadPlugin } from './src/recipes/ldtk-hot-reload-plugin';
 *
 * export default defineConfig({
 *   plugins: [createLdtkHotReloadPlugin()],
 * });
 * ```
 */
export function createLdtkHotReloadPlugin(
  options: Readonly<LdtkHotReloadPluginOptions> = {},
): LdtkHotReloadPlugin {
  const directory = options.directory ?? 'public';
  const event = options.event ?? LDTK_HOT_RELOAD_EVENT;
  return {
    name: 'ldtk-hot-reload',
    apply: 'serve',
    configureServer(server) {
      server.watcher.add(resolve(directory));
      server.watcher.on('change', (file) => {
        if (file.endsWith('.ldtk')) {
          server.ws.send(event, { file });
        }
      });
    },
  };
}
