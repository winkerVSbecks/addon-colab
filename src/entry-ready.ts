/**
 * "Can the preview load this entry yet?", asked by the manager before it opens a canvas it just
 * created. Safe in manager, preview and Node (only `ADDON_ID` and type imports).
 *
 * Why: a new canvas file reaches Storybook's index (which the manager reads) a moment before it
 * reaches the preview's map of story files (the builder's stories module). Navigating in between made
 * the preview show Storybook's own error page, "importers[path] is not a function", until the page
 * was reloaded. The preview's answer comes from `src/canvas-page/entry-ready.ts`, which loads the
 * entry the way Storybook will and refreshes a stale map first.
 *
 * The answer is a hint, never a gate: with no answer in time (or `false`), the manager navigates
 * anyway, as it did before.
 */
import type { ChannelLike } from './channel';
import { ADDON_ID } from './constants';

/** Manager → preview: `{ id, storyId }`. */
export const ENTRY_READY_REQUEST = `${ADDON_ID}/entry-ready-request`;
/** Preview → manager: `{ id, ready }`. */
export const ENTRY_READY_RESPONSE = `${ADDON_ID}/entry-ready-response`;

export interface EntryReadyRequest {
  id: string;
  storyId: string;
}

export interface EntryReadyResponse {
  id: string;
  /** `true` when the preview loaded the entry; `false` when it gave up (the manager navigates anyway). */
  ready: boolean;
}

/** How long the preview keeps trying before it answers `false`. */
export const ENTRY_READY_BUDGET_MS = 5_000;

let nextRequest = 0;

/**
 * Asks the preview whether it can load `storyId`, and resolves with its answer: `true` (it can),
 * `false` (it gave up), or `undefined` (no answer within `timeoutMs`, for example no preview loaded).
 * Never rejects.
 */
export function waitForEntryReady(
  channel: ChannelLike,
  storyId: string,
  { timeoutMs = ENTRY_READY_BUDGET_MS + 1_000 }: { timeoutMs?: number } = {},
): Promise<boolean | undefined> {
  const id = `${Date.now().toString(36)}-${(nextRequest += 1)}`;
  return new Promise((resolve) => {
    const finish = (ready: boolean | undefined) => {
      clearTimeout(timer);
      channel.off(ENTRY_READY_RESPONSE, onResponse);
      resolve(ready);
    };
    const onResponse = (response: Partial<EntryReadyResponse> | undefined) => {
      if (response?.id === id) finish(response.ready === true);
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    channel.on(ENTRY_READY_RESPONSE, onResponse);
    try {
      channel.emit(ENTRY_READY_REQUEST, { id, storyId } satisfies EntryReadyRequest);
    } catch {
      finish(undefined);
    }
  });
}
