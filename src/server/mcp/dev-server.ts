/**
 * Mounts the canvas MCP endpoint on the Storybook dev server. Called from the preset's
 * `experimental_devServer` hook, so it runs inside the dev server process and shares the canvas
 * store (and its per-canvas locks and change events) with the browser channel. Never opened by a
 * second process: two writers on one canvas directory lose writes.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import { isValidHost } from 'storybook/internal/core-server';
import type { Options } from 'storybook/internal/types';

import packageJson from '../../../package.json' with { type: 'json' };
import { getCanvasStore } from '../canvas-store';
import type { StoryInfo, StoryLookup } from './format';
import { COLAB_MCP_ENDPOINT, createMcpRequestHandler } from './http';

/** The part of Storybook's polka app this needs. */
export interface DevServerApp {
  all(path: string, handler: (req: IncomingMessage, res: ServerResponse) => unknown): unknown;
}

interface IndexEntry {
  type?: string;
  title?: string;
  name?: string;
  importPath?: string;
}

interface StoryIndexGeneratorLike {
  getIndex(): Promise<{ entries: Record<string, IndexEntry> }>;
}

export async function registerColabMcp(app: DevServerApp, options: Options, { dir }: { dir: string }): Promise<void> {
  const core = await options.presets.apply('core', {});
  const hostOptions = {
    host: options.host,
    allowedHosts: core?.allowedHosts,
    localAddress: options.localAddress,
    networkAddress: options.networkAddress,
  };
  const store = getCanvasStore({ dir });

  const stories = async (): Promise<StoryLookup> => {
    const generator = (await options.presets.apply<unknown>('storyIndexGenerator')) as StoryIndexGeneratorLike;
    const { entries } = await generator.getIndex();
    return (storyId: string): StoryInfo | undefined => {
      const entry = entries[storyId];
      if (!entry?.title || !entry.importPath) return undefined;
      return { title: entry.title, name: entry.name ?? storyId, importPath: entry.importPath };
    };
  };

  app.all(
    COLAB_MCP_ENDPOINT,
    createMcpRequestHandler({
      store,
      stories,
      version: packageJson.version,
      isAllowedOriginHost: (host) => isValidHost(host, hostOptions),
    }),
  );
}
