import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isReloadingStoriesModule,
  isStaleStoriesModuleError,
  reloadStoriesModule,
  resetStoriesModuleReload,
  storiesModuleUrl,
} from './stories-module';

const MODULE = 'http://127.0.0.1:6006/@id/__x00__virtual:/@storybook/builder-vite/storybook-stories.js';

afterEach(() => resetStoriesModuleReload());

describe('isStaleStoriesModuleError', () => {
  it('recognises the builder importFn failure only', () => {
    expect(isStaleStoriesModuleError(new TypeError('importers[path] is not a function'))).toBe(true);
    expect(isStaleStoriesModuleError('importers[path] is not a function')).toBe(true);
    expect(isStaleStoriesModuleError(new Error("Couldn't find story matching id 'a--b' after HMR."))).toBe(false);
    expect(isStaleStoriesModuleError(new Error('x is not a function'))).toBe(false);
    expect(isStaleStoriesModuleError(undefined)).toBe(false);
  });
});

describe('storiesModuleUrl', () => {
  it('uses the URL the page loaded the module from, without its query', () => {
    expect(storiesModuleUrl(['http://h/a.js', `${MODULE}?t=123`], 'http://h/iframe.html')).toBe(MODULE);
  });

  it('falls back to Vite’s path for the virtual module on this origin', () => {
    expect(storiesModuleUrl([], 'http://127.0.0.1:6006/iframe.html?id=x')).toBe(MODULE);
  });
});

describe('reloadStoriesModule', () => {
  const importFn = async () => ({});

  it('imports the module with a fresh t query and hands its importFn to the preview', async () => {
    const seen: unknown[] = [];
    let reloadingDuringHandover = false;
    const preview = {
      onStoriesChanged: async (changes: { importFn: unknown }) => {
        reloadingDuringHandover = isReloadingStoriesModule();
        seen.push(changes.importFn);
      },
    };
    const importModule = vi.fn(async () => ({ importFn }));
    const ok = await reloadStoriesModule(preview, { importModule, moduleUrl: () => MODULE, now: () => 5000 });
    expect(ok).toBe(true);
    expect(importModule).toHaveBeenCalledWith(`${MODULE}?t=5000`);
    expect(seen).toEqual([importFn]);
    expect(reloadingDuringHandover).toBe(true);
    expect(isReloadingStoriesModule()).toBe(false);
  });

  it('shares one reload between calls close together, and reloads again later', async () => {
    let time = 1000;
    const preview = { onStoriesChanged: vi.fn(async () => undefined) };
    const importModule = vi.fn(async () => ({ importFn }));
    const options = { importModule, moduleUrl: () => MODULE, now: () => time };
    await Promise.all([reloadStoriesModule(preview, options), reloadStoriesModule(preview, options)]);
    time += 100;
    await reloadStoriesModule(preview, options);
    expect(importModule).toHaveBeenCalledTimes(1);
    time += 1000;
    await reloadStoriesModule(preview, options);
    expect(importModule).toHaveBeenCalledTimes(2);
  });

  it('resolves false when it cannot reload', async () => {
    const options = { moduleUrl: () => MODULE, now: () => 0 };
    expect(await reloadStoriesModule({}, { ...options, importModule: async () => ({ importFn }) })).toBe(false);
    resetStoriesModuleReload();
    const preview = { onStoriesChanged: vi.fn(async () => undefined) };
    expect(
      await reloadStoriesModule(preview, {
        ...options,
        importModule: async () => {
          throw new Error('404');
        },
      }),
    ).toBe(false);
    resetStoriesModuleReload();
    expect(await reloadStoriesModule(preview, { ...options, importModule: async () => ({}) })).toBe(false);
    expect(preview.onStoriesChanged).not.toHaveBeenCalled();
  });

  it('is not reloading after the preview rejects the new importFn', async () => {
    const preview = {
      onStoriesChanged: async () => {
        throw new Error('not initialised');
      },
    };
    expect(
      await reloadStoriesModule(preview, {
        importModule: async () => ({ importFn }),
        moduleUrl: () => MODULE,
        now: () => 0,
      }),
    ).toBe(false);
    expect(isReloadingStoriesModule()).toBe(false);
  });
});
