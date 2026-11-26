/**
 * Preview side of opening a canvas entry: makes sure the preview can load the entry, so Storybook
 * never shows its own error page ("importers[path] is not a function") for a canvas.
 *
 * The cause is the one `board/stories-module.ts` describes: the preview's map of story files (the
 * builder's stories module) can lag behind Storybook's index, or stay stale. A canvas entry's CSF
 * stub is a story file like any other, so a canvas opened in that window fails before the board (and
 * its own retries) exists. Two parts:
 *
 * 1. **Before navigating** (`answerEntryReady`): the manager asks whether an entry can be loaded
 *    (`src/entry-ready.ts`). The preview calls `loadStory` (a public `PreviewWeb` method) for it; a
 *    stale map is refreshed with `reloadStoriesModule` and the load tried again, until it works or
 *    `ENTRY_READY_BUDGET_MS` runs out. Loading a canvas stub has no side effects.
 * 2. **Safety net** (`recoverCanvasEntries`): if Storybook still reports a canvas entry it is showing as
 *    missing (`STORY_MISSING`), the preview refreshes the map, which makes Storybook render its
 *    selection again. A few times at most per entry, and only while that entry is still selected.
 *
 * Everything here only adds retries: if the preview global, `loadStory` or the stories module is not
 * there (a static build, another builder, a later Storybook), it answers "not ready" / does nothing,
 * and Storybook behaves as it would without the addon.
 */
import { CURRENT_STORY_WAS_SET, STORY_MISSING, STORY_RENDERED } from 'storybook/internal/core-events';

import { isCanvasStoryId } from '../canvas-entry';
import type { ChannelLike } from '../channel';
import {
  ENTRY_READY_BUDGET_MS,
  ENTRY_READY_REQUEST,
  ENTRY_READY_RESPONSE,
  type EntryReadyRequest,
} from '../entry-ready';
import { type StoriesChangedTarget, isStaleStoriesModuleError, reloadStoriesModule } from './board/stories-module';

/** The parts of `window.__STORYBOOK_PREVIEW__` this uses. */
export interface EntryPreview extends StoriesChangedTarget {
  loadStory: (selection: { storyId: string }) => Promise<unknown>;
}

export function getEntryPreview(): EntryPreview | undefined {
  const preview = (globalThis as { __STORYBOOK_PREVIEW__?: Partial<EntryPreview> }).__STORYBOOK_PREVIEW__;
  return preview && typeof preview.loadStory === 'function' ? (preview as EntryPreview) : undefined;
}

export interface EntryReadyOptions {
  getPreview?: () => EntryPreview | undefined;
  reload?: (preview: EntryPreview) => Promise<boolean>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const RETRY_MS = 150;
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Resolves `true` once the preview loads `storyId`, `false` if it still cannot after `budgetMs`. A
 * load that fails on a stale map of story files refreshes the map first; any other failure (the
 * preview's index does not have the entry yet, the preview is still starting) is simply retried.
 */
export async function prepareEntry(
  storyId: string,
  budgetMs = ENTRY_READY_BUDGET_MS,
  {
    getPreview = getEntryPreview,
    reload = (preview) => reloadStoriesModule(preview),
    now = Date.now,
    sleep = defaultSleep,
  }: EntryReadyOptions = {},
): Promise<boolean> {
  const deadline = now() + budgetMs;
  for (;;) {
    const preview = getPreview();
    if (preview) {
      try {
        await preview.loadStory({ storyId });
        return true;
      } catch (error) {
        if (isStaleStoriesModuleError(error)) await reload(preview);
      }
    }
    if (now() >= deadline) return false;
    await sleep(RETRY_MS);
  }
}

/** Answers the manager's "can you load this entry?" requests. Returns a function that stops it. */
export function answerEntryReady(channel: ChannelLike, options: EntryReadyOptions = {}): () => void {
  const onRequest = (request: Partial<EntryReadyRequest> | undefined) => {
    if (typeof request?.id !== 'string' || typeof request.storyId !== 'string') return;
    const { id, storyId } = request;
    void prepareEntry(storyId, ENTRY_READY_BUDGET_MS, options)
      .catch(() => false)
      .then((ready) => channel.emit(ENTRY_READY_RESPONSE, { id, ready }));
  };
  channel.on(ENTRY_READY_REQUEST, onRequest);
  return () => channel.off(ENTRY_READY_REQUEST, onRequest);
}

/** Delays before each recovery attempt for one canvas entry; no more attempts after the last. */
export const RECOVERY_DELAYS_MS = [300, 1_000, 2_500, 5_000];

/**
 * The safety net: when Storybook reports the canvas entry it is showing as missing, refresh the map
 * of story files (Storybook then renders its selection again). Stops for an entry once it renders,
 * once another entry is selected, or after `RECOVERY_DELAYS_MS` attempts. Returns a function that
 * stops it.
 */
export function recoverCanvasEntries(
  channel: ChannelLike,
  {
    getPreview = getEntryPreview,
    reload = (preview) => reloadStoriesModule(preview),
    delays = RECOVERY_DELAYS_MS,
  }: Pick<EntryReadyOptions, 'getPreview' | 'reload'> & { delays?: readonly number[] } = {},
): () => void {
  /** The entry being recovered and how many attempts it has had. */
  let current: { storyId: string; attempts: number } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
    current = undefined;
  };

  const onMissing = (storyId: unknown) => {
    if (typeof storyId !== 'string' || !isCanvasStoryId(storyId)) return;
    if (current?.storyId !== storyId) {
      stop();
      current = { storyId, attempts: 0 };
    }
    if (timer !== undefined || current.attempts >= delays.length) return;
    const delay = delays[current.attempts]!;
    current.attempts += 1;
    const entry = current;
    timer = setTimeout(() => {
      timer = undefined;
      if (current !== entry) return;
      const preview = getPreview();
      // A failed refresh is followed by nothing; a refresh that does not help makes Storybook report
      // the entry missing again, which schedules the next attempt.
      if (preview) void reload(preview).catch(() => false);
    }, delay);
  };
  const onRendered = (storyId: unknown) => {
    if (current && storyId === current.storyId) stop();
  };
  const onSelected = (selection: { storyId?: unknown } | undefined) => {
    if (current && selection?.storyId !== current.storyId) stop();
  };

  channel.on(STORY_MISSING, onMissing);
  channel.on(STORY_RENDERED, onRendered);
  channel.on(CURRENT_STORY_WAS_SET, onSelected);
  return () => {
    stop();
    channel.off(STORY_MISSING, onMissing);
    channel.off(STORY_RENDERED, onRendered);
    channel.off(CURRENT_STORY_WAS_SET, onSelected);
  };
}

const INSTALLED = Symbol.for('addon-colab/entry-ready');

/** Installs both parts once per page (the preview entry can be evaluated again by hot reload). */
export function installEntryReady(channel: ChannelLike): void {
  const page = globalThis as { [INSTALLED]?: boolean };
  if (page[INSTALLED]) return;
  page[INSTALLED] = true;
  answerEntryReady(channel);
  recoverCanvasEntries(channel);
}
