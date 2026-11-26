/**
 * Marks broken canvas files in the sidebar with a warning status, through Storybook's status store
 * (`experimental_getStatusStore`, the API test addons use for their sidebar icons). That leaves the
 * project's own `renderLabel` alone. The "(invalid)" label text stays as the plain-text marker.
 */
import { experimental_getStatusStore } from 'storybook/manager-api';
import type { Status } from 'storybook/internal/types';

import { canvasStoryId } from '../canvas-entry';
import { type CanvasListing, type ChannelLike, onCanvasChanged, requestCanvas } from '../channel';
import { ADDON_ID } from '../constants';

export const BROKEN_CANVAS_STATUS = `${ADDON_ID}/broken-canvas`;

/** One warning status per canvas file that cannot be read. */
export function brokenCanvasStatuses(listing: CanvasListing): Status[] {
  return listing.invalid.map((file) => ({
    storyId: canvasStoryId(file.id),
    typeId: BROKEN_CANVAS_STATUS,
    value: 'status-value:warning',
    title: "Canvas file can't be read",
    description: `${file.file}: ${file.errors.join('; ')}`,
  }));
}

type StatusStoreLike = Pick<ReturnType<typeof experimental_getStatusStore>, 'set' | 'unset'>;

/** Keeps the statuses in step with the canvas server. Returns a function that stops it. */
export function trackBrokenCanvases(
  channel: ChannelLike,
  store: StatusStoreLike = experimental_getStatusStore(BROKEN_CANVAS_STATUS),
): () => void {
  let latest = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const load = () => {
    const request = ++latest;
    requestCanvas(channel, 'list').then(
      (listing) => {
        if (request !== latest) return;
        store.unset();
        store.set(brokenCanvasStatuses(listing));
      },
      () => {
        // No canvas server (it stopped): leave the last known statuses.
      },
    );
  };
  load();
  const unsubscribe = onCanvasChanged(channel, () => {
    clearTimeout(timer);
    timer = setTimeout(load, 100);
  });
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}
