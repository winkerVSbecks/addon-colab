/**
 * How the canvas page decides what to show before and after asking the canvas server. Pure, so it
 * can be tested without a browser; `useCanvasPageState` in `CanvasPage.tsx` wires it to the channel.
 */
import { isCanvasId } from '../canvas-file';
import { CanvasRequestError } from '../channel';
import type { CanvasPageState } from './CanvasPageView';

/**
 * The problem shown for a file whose name is not a canvas id (`My Board!.json`). The store only
 * opens files named like a canvas id and answers NOT_FOUND for anything else, so the page must not
 * ask: the file exists, and the fix is to rename it.
 */
export function badFileNameErrors(fileId: string): string[] {
  return [`file name: "${fileId}" is not a canvas id (a lowercase slug such as "design-review")`];
}

/**
 * The state to show before the server answers, or `null` when the page has to ask. A bad file name
 * goes straight to the invalid state.
 */
export function initialCanvasPageState(fileId: string, supported: boolean): CanvasPageState | null {
  if (!supported) return { kind: 'unsupported' };
  if (!isCanvasId(fileId)) return { kind: 'invalid', fileId, errors: badFileNameErrors(fileId) };
  return null;
}

/** The state for a failed `get` of this canvas. */
export function canvasPageStateFromError(fileId: string, error: unknown): CanvasPageState {
  if (!isCanvasId(fileId)) return { kind: 'invalid', fileId, errors: badFileNameErrors(fileId) };
  if (error instanceof CanvasRequestError) {
    if (error.code === 'NOT_FOUND') return { kind: 'missing', fileId };
    if (error.code === 'INVALID_FILE' || error.code === 'INVALID_INPUT') {
      return { kind: 'invalid', fileId, errors: error.errors.length ? error.errors : [error.message] };
    }
    return { kind: 'error', message: error.message };
  }
  return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
}
