/**
 * How canvases appear in Storybook's index: one sidebar entry per canvas file, under "Canvases".
 * Shared by the indexer (Node), the manager and the preview, so it has no runtime imports
 * beyond `./canvas-file`'s id check.
 *
 * Story ids are fixed by the file name, not the canvas name, so renaming a canvas keeps its URL:
 * - `design-review.json` → `colab-canvas-design-review--canvas`
 * - a file whose name is not a canvas id (`My Board.json`) → `colab-canvas-my-board-<hash>--invalid`
 *   (it can only be shown as broken and deleted, and the hash keeps two such names apart)
 */
import { isCanvasId } from './canvas-file';

/** Sidebar group (index title) that holds every canvas. */
export const CANVAS_TITLE = 'Canvases';
/** Tag on every canvas entry. The manager uses it to tell canvases from stories. */
export const CANVAS_TAG = 'colab-canvas';
/** Extra tag on entries whose file cannot be read as a canvas. */
export const INVALID_CANVAS_TAG = 'colab-canvas-invalid';
/** Story parameter that carries the canvas file id (file name without `.json`) to the preview. */
export const CANVAS_PARAMETER = 'colabCanvas';

const META_PREFIX = 'colab-canvas-';
/** Export names of the generated CSF stub; Storybook derives the `--canvas` / `--invalid` suffix from them. */
export const CANVAS_EXPORT_NAME = 'Canvas';
export const INVALID_EXPORT_NAME = 'Invalid';

/** Lowercase letters, digits and single dashes: unchanged by Storybook's own id sanitising. */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** FNV-1a, 32 bit, base 36. Only used to keep ids of oddly named files apart. */
function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** The CSF meta id (component id) for a canvas file. */
export function canvasMetaId(fileId: string): string {
  if (isCanvasId(fileId)) return `${META_PREFIX}${fileId}`;
  const base = slug(fileId);
  return `${META_PREFIX}${base ? `${base}-` : ''}${shortHash(fileId)}`;
}

/** The export name used for a canvas file in its CSF stub. */
export function canvasExportName(fileId: string): string {
  return isCanvasId(fileId) ? CANVAS_EXPORT_NAME : INVALID_EXPORT_NAME;
}

/** The Storybook story id (the `?path=/story/<id>` part of the URL) for a canvas file id. */
export function canvasStoryId(fileId: string): string {
  return `${canvasMetaId(fileId)}--${canvasExportName(fileId).toLowerCase()}`;
}

/** Whether a story id belongs to a canvas entry (works after the entry has left the index). */
export function isCanvasStoryId(storyId: string | undefined): boolean {
  return !!storyId?.startsWith(META_PREFIX);
}

/** Whether an index entry is a canvas, from its tags. */
export function isCanvasEntry(entry: { tags?: string[] } | undefined | null): boolean {
  return !!entry?.tags?.includes(CANVAS_TAG);
}
