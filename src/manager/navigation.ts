/**
 * Moving between canvas pages from the manager. Canvas entries come from Storybook's index, which
 * updates a moment after the store writes a file, so opening a new canvas waits for its entry, and
 * deleting the open canvas leaves its page first (Storybook shows an error screen for an open entry
 * that disappears from the index).
 */
import type { API } from 'storybook/manager-api';

import { canvasStoryId, isCanvasEntry, isCanvasStoryId } from '../canvas-entry';

type NavigationApi = Pick<API, 'getData' | 'getIndex' | 'getUrlState' | 'selectStory'>;

const POLL_MS = 100;

function waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (check()) resolve(true);
      else if (Date.now() - started >= timeoutMs) resolve(false);
      else setTimeout(tick, POLL_MS);
    };
    tick();
  });
}

function hasEntry(api: NavigationApi, storyId: string): boolean {
  try {
    return !!api.getData(storyId);
  } catch {
    return false;
  }
}

/** Opens a canvas once its entry is in the index. Resolves `false` if it did not appear in time. */
export async function openCanvas(api: NavigationApi, fileId: string, timeoutMs = 10_000): Promise<boolean> {
  const storyId = canvasStoryId(fileId);
  const found = await waitFor(() => hasEntry(api, storyId), timeoutMs);
  if (found) api.selectStory(storyId);
  return found;
}

/** Whether the canvas with this file id is the page being shown. */
export function isCanvasOpen(api: Pick<API, 'getUrlState'>, fileId: string): boolean {
  return api.getUrlState().storyId === canvasStoryId(fileId);
}

/** Where to land after leaving a canvas: the first entry that is not a canvas, else another canvas. */
function fallbackEntryId(api: NavigationApi, leaving: string): string | undefined {
  const entries = Object.values(api.getIndex()?.entries ?? {});
  return (
    entries.find((entry) => !isCanvasEntry(entry))?.id ??
    entries.find((entry) => entry.type === 'story' && entry.id !== leaving)?.id
  );
}

/**
 * If the canvas is open, navigates to the first entry that is not a canvas (or another canvas) and
 * waits until the URL has changed. With nothing else in the index it stays, and Storybook shows its
 * own "not found" screen once the entry is gone.
 */
export async function leaveCanvas(api: NavigationApi, fileId: string): Promise<void> {
  if (!isCanvasOpen(api, fileId)) return;
  await leaveStory(api, canvasStoryId(fileId));
}

async function leaveStory(api: NavigationApi, storyId: string): Promise<void> {
  const fallback = fallbackEntryId(api, storyId);
  if (!fallback) return;
  api.selectStory(fallback);
  await waitFor(() => api.getUrlState().storyId !== storyId, 3_000);
}

/**
 * Call when Storybook's index changes. If the open page is a canvas whose entry has left the index
 * (its file was deleted by hand, by git, or anywhere else), leaves it. This does not rely on the
 * canvas store noticing the delete.
 */
export async function leaveRemovedCanvas(api: NavigationApi, waitMs = 2_000): Promise<void> {
  const { storyId } = api.getUrlState();
  if (!storyId || !isCanvasStoryId(storyId)) return;
  const removed = await waitFor(() => !hasEntry(api, storyId), waitMs);
  if (removed && api.getUrlState().storyId === storyId) await leaveStory(api, storyId);
}
