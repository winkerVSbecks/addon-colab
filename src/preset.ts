// Node-side preset: canvas storage over Storybook's server channel. The MCP endpoint is added here too.
import { isAbsolute, join, resolve } from 'node:path';

import type { Options } from 'storybook/internal/types';

import type { ChannelLike } from './channel';
import { registerCanvasChannel } from './server/canvas-channel';
import { canvasEntryPresets } from './server/canvas-index';
import { getCanvasStore } from './server/canvas-store';
import { type DevServerApp, registerColabMcp } from './server/mcp/dev-server';

/** Addon options, set in `.storybook/main` as `{ name: 'storybook-addon-colab', options: { canvasDir } }`. */
export interface ColabAddonOptions {
  /** Where canvas files live. Relative paths resolve against the project root. Default `<configDir>/canvases`. */
  canvasDir?: string;
}

/** The canvas directory for these preset options. */
export function canvasDirFor(options: Pick<Options, 'configDir'> & ColabAddonOptions): string {
  if (options.canvasDir) {
    return isAbsolute(options.canvasDir) ? options.canvasDir : resolve(process.cwd(), options.canvasDir);
  }
  return join(resolve(options.configDir), 'canvases');
}

// Same hook Storybook's core features (save story, create story, open in editor) use; dev server only.
export const experimental_serverChannel = async <C extends ChannelLike>(
  channel: C,
  options: Options & ColabAddonOptions,
): Promise<C> => {
  const store = getCanvasStore({ dir: canvasDirFor(options) });
  try {
    await store.watch();
  } catch (error) {
    console.error(
      `[addon-colab] cannot watch ${store.dir}; edits made outside Storybook will not show until reload`,
      error,
    );
  }
  registerCanvasChannel(channel, store);
  return channel;
};

// MCP endpoint for coding agents: served by this dev server and backed by the same store.
export const experimental_devServer = async <A extends DevServerApp>(
  app: A,
  options: Options & ColabAddonOptions,
): Promise<A> => {
  await registerColabMcp(app, options, { dir: canvasDirFor(options) });
  return app;
};

// Canvases as sidebar entries: one "Canvases" entry per canvas file, dev server only.
// `tags` keeps the canvas tags out of the sidebar's tag filter.
export const { stories, experimental_indexers, viteFinal, tags } = canvasEntryPresets<Options & ColabAddonOptions>(
  canvasDirFor,
);
