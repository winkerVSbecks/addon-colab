/**
 * Brings the preview's map of story files up to date when it has gone stale.
 *
 * Storybook's Vite builder serves a generated module (`virtual:/@storybook/builder-vite/storybook-stories.js`)
 * whose `importFn(path)` imports each story file. When the story index changes, the builder
 * regenerates it and its hot-update handler passes the new `importFn` to
 * `__STORYBOOK_PREVIEW__.onStoriesChanged({ importFn })`. When a deleted story file is restored, Vite
 * also reloads the preview page, and the reloaded page can receive a copy of that module generated
 * before the file was back. No further update follows, so every load of the story then fails with
 * "importers[path] is not a function" until the page is reloaded by hand.
 *
 * `reloadStoriesModule` does what the builder's hot-update handler does: it imports the module again
 * (with a fresh `t` query, as Vite's own updates do) and hands its `importFn` to `onStoriesChanged`.
 */

/** The preview method the builder's hot-update handler calls with a new `importFn`. */
export interface StoriesChangedTarget {
  onStoriesChanged?: (changes: { importFn: (path: string) => Promise<unknown> }) => Promise<void>;
}

const STORIES_MODULE_ID = 'virtual:/@storybook/builder-vite/storybook-stories.js';
/** How Vite serves a `\0`-prefixed virtual module; used when the page's resource list lacks it. */
const STORIES_MODULE_PATH = `/@id/__x00__${STORIES_MODULE_ID}`;
/** Reloads closer together than this share one import. */
const MIN_INTERVAL = 400;

/**
 * Whether a story load failed because the preview's map of story files lacks the story's file
 * although the index lists it (`importers[path] is not a function` from the builder's `importFn`).
 */
export function isStaleStoriesModuleError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /importers\[[^\]]*\] is not a function/.test(message);
}

/** The URL the page loaded the stories module from (without its query), if it is a Vite dev page. */
export function storiesModuleUrl(
  resources: readonly string[] = performance.getEntriesByType('resource').map((entry) => entry.name),
  base: string = location.href,
): string {
  const loaded = resources.find((name) => name.split('?')[0]!.endsWith(STORIES_MODULE_PATH));
  return loaded ? loaded.split('?')[0]! : new URL(STORIES_MODULE_PATH, base).href;
}

let pending: { promise: Promise<boolean>; at: number } | undefined;
let handingOver = 0;

/**
 * Whether a reload is handing its `importFn` to the preview right now. The preview re-renders its
 * selection meanwhile and emits `STORY_UNCHANGED`; the board ignores that one, so a reload never
 * triggers another round of refreshes (and reloads) by itself.
 */
export function isReloadingStoriesModule(): boolean {
  return handingOver > 0;
}

/**
 * Imports the stories module again and gives its `importFn` to the preview. Resolves `true` when the
 * preview got a new `importFn`, `false` when that was not possible (not a Vite dev server, import
 * failed). Calls within `MIN_INTERVAL` of the last one share its result.
 */
export function reloadStoriesModule(
  preview: StoriesChangedTarget,
  {
    importModule = (url) => import(/* @vite-ignore */ url),
    moduleUrl = () => storiesModuleUrl(),
    now = Date.now,
  }: {
    importModule?: (url: string) => Promise<{ importFn?: unknown }>;
    moduleUrl?: () => string;
    now?: () => number;
  } = {},
): Promise<boolean> {
  if (pending && now() - pending.at < MIN_INTERVAL) return pending.promise;
  const at = now();
  const promise = (async () => {
    if (typeof preview.onStoriesChanged !== 'function') return false;
    try {
      const module = await importModule(`${moduleUrl()}?t=${at}`);
      if (typeof module.importFn !== 'function') return false;
      handingOver += 1;
      try {
        await preview.onStoriesChanged({ importFn: module.importFn as (path: string) => Promise<unknown> });
      } finally {
        handingOver -= 1;
      }
      return true;
    } catch {
      return false;
    }
  })();
  pending = { promise, at };
  return promise;
}

/** Forgets the shared in-flight reload (tests). */
export function resetStoriesModuleReload(): void {
  pending = undefined;
  handingOver = 0;
}
